using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace OpenWhiteboardDesktop;

public partial class MainWindow : Window
{
    private readonly string? pendingNotePath;
    private readonly string executableDirectory;
    private readonly string dataDirectory;
    private readonly string notesDirectory;
    private readonly string autosaveDirectory;
    private readonly string settingsPath;
    private string? currentNotePath;
    private bool pendingNoteOpened;
    private bool startupInfoPosted;

    private const string AppTitle =
        "Chalkline Board";

    private const string HostName =
        "chalkline-board.local";

    private const string DataDirectoryName =
        "ChalklineBoard_Data";

    public MainWindow()
    {
        InitializeComponent();
        executableDirectory = GetExecutableDirectory();
        dataDirectory = Path.Combine(executableDirectory, DataDirectoryName);
        notesDirectory = Path.Combine(dataDirectory, "notes");
        autosaveDirectory = Path.Combine(dataDirectory, "autosave");
        settingsPath = Path.Combine(dataDirectory, "settings.json");
        pendingNotePath = Environment.GetCommandLineArgs().Skip(1).FirstOrDefault(IsSupportedNotePath);
        Title = AppTitle;
        Loaded += async (_, _) => await InitializeWhiteboardAsync();
    }

    private async Task InitializeWhiteboardAsync()
    {
        EnsurePortableDirectories();

        var userDataFolder = Path.Combine(dataDirectory, "WebView2");
        Directory.CreateDirectory(userDataFolder);

        var environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
        await WhiteboardView.EnsureCoreWebView2Async(environment);

        var appFolder = ResolveAppFolder();
        if (!File.Exists(Path.Combine(appFolder, "index.html")))
        {
            MessageBox.Show(
                "Desktop app assets were not found. Run the matching desktop build before publishing.",
                AppTitle,
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Close();
            return;
        }

        WhiteboardView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            HostName,
            appFolder,
            CoreWebView2HostResourceAccessKind.Allow);

        WhiteboardView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        WhiteboardView.CoreWebView2.Settings.AreDevToolsEnabled = false;
        WhiteboardView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        WhiteboardView.CoreWebView2.Settings.IsZoomControlEnabled = false;
        WhiteboardView.CoreWebView2.Settings.IsWebMessageEnabled = true;
        WhiteboardView.CoreWebView2.WebMessageReceived += HandleWebMessageReceived;
        WhiteboardView.CoreWebView2.NewWindowRequested += (_, args) => args.Handled = true;
        WhiteboardView.CoreWebView2.NavigationCompleted += async (_, _) =>
        {
            StartupOverlay.Visibility = Visibility.Collapsed;
            await OpenStartupNoteFileAfterLoadAsync();
        };

        WhiteboardView.Source = new Uri($"https://{HostName}/index.html");
        WhiteboardView.Focus();
    }

    private void HandleWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        var command = args.TryGetWebMessageAsString();
        if (command == "close")
        {
            Close();
            return;
        }

        if (command == "minimize")
        {
            WindowState = WindowState.Minimized;
            return;
        }


        if (command == "app-ready")
        {
            StartupOverlay.Visibility = Visibility.Collapsed;
            PostStartupInfo();
            OpenStartupNoteFile();
            return;
        }

        TryHandleJsonCommand(command);
    }

    private async Task OpenStartupNoteFileAfterLoadAsync()
    {
        await Task.Delay(250);
        OpenStartupNoteFile();
    }

    private void TryHandleJsonCommand(string? command)
    {
        if (string.IsNullOrWhiteSpace(command)) return;

        try
        {
            using var document = JsonDocument.Parse(command);
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var typeProperty)) return;

            var type = typeProperty.GetString();
            if (type == "save-note-file" || type == "autosave-note-file")
            {
                var fileName = root.TryGetProperty("fileName", out var fileNameProperty)
                    ? fileNameProperty.GetString()
                    : null;
                var content = root.TryGetProperty("content", out var contentProperty)
                    ? contentProperty.GetString()
                    : null;
                SaveNoteFile(fileName, content, type == "autosave-note-file");
            }
        }
        catch (JsonException)
        {
            // Plain string commands are handled before JSON command parsing.
        }
    }

    private static bool IsSupportedNotePath(string? path)
    {
        return !string.IsNullOrWhiteSpace(path) &&
            File.Exists(path) &&
            string.Equals(Path.GetExtension(path), ".owbn", StringComparison.OrdinalIgnoreCase);
    }

    private static string GetExecutableDirectory()
    {
        var processPath = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(processPath))
        {
            return Path.GetDirectoryName(processPath) ?? AppContext.BaseDirectory;
        }

        return AppContext.BaseDirectory;
    }

    private void EnsurePortableDirectories()
    {
        Directory.CreateDirectory(dataDirectory);
        Directory.CreateDirectory(notesDirectory);
        Directory.CreateDirectory(autosaveDirectory);
    }

    private string ResolveAppFolder()
    {
        var externalAppFolder = Path.Combine(AppContext.BaseDirectory, "app");
        if (File.Exists(Path.Combine(externalAppFolder, "index.html")))
        {
            return externalAppFolder;
        }

        return ExtractEmbeddedAppAssets();
    }

    private string ExtractEmbeddedAppAssets()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resources = assembly
            .GetManifestResourceNames()
            .Where(name => name.StartsWith("app/", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        var cacheDirectory = Path.Combine(dataDirectory, "app-cache");
        var markerPath = Path.Combine(cacheDirectory, ".asset-version");
        var version = assembly.ManifestModule.ModuleVersionId.ToString("N");

        if (
            File.Exists(Path.Combine(cacheDirectory, "index.html")) &&
            File.Exists(markerPath) &&
            string.Equals(File.ReadAllText(markerPath, Encoding.UTF8).Trim(), version, StringComparison.Ordinal))
        {
            return cacheDirectory;
        }

        if (Directory.Exists(cacheDirectory))
        {
            Directory.Delete(cacheDirectory, true);
        }

        Directory.CreateDirectory(cacheDirectory);
        foreach (var resourceName in resources)
        {
            var relativePath = resourceName["app/".Length..].Replace('/', Path.DirectorySeparatorChar);
            if (string.IsNullOrWhiteSpace(relativePath)) continue;

            var destinationPath = Path.Combine(cacheDirectory, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
            using var resourceStream = assembly.GetManifestResourceStream(resourceName);
            if (resourceStream == null) continue;
            using var fileStream = File.Create(destinationPath);
            resourceStream.CopyTo(fileStream);
        }

        File.WriteAllText(markerPath, version, Encoding.UTF8);
        return cacheDirectory;
    }

    private void OpenStartupNoteFile()
    {
        if (pendingNoteOpened) return;
        var settings = LoadPortableSettings();
        var notePath = IsSupportedNotePath(pendingNotePath) ? pendingNotePath : settings.LastNotePath;
        if (!IsSupportedNotePath(notePath)) return;

        try
        {
            pendingNoteOpened = true;
            currentNotePath = notePath;
            UpdatePortableSettings(notePath!);
            var payload = JsonSerializer.Serialize(new
            {
                type = "open-note-file",
                fileName = Path.GetFileName(notePath!),
                content = File.ReadAllText(notePath!, Encoding.UTF8),
            });
            WhiteboardView.CoreWebView2.PostWebMessageAsJson(payload);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                $"Whiteboard note file could not be opened.\n\n{error.Message}",
                AppTitle,
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
    }

    private void SaveNoteFile(string? requestedFileName, string? content, bool autosave)
    {
        if (string.IsNullOrEmpty(content))
        {
            PostSaveResult(autosave, null, "Whiteboard note content is empty.");
            return;
        }

        try
        {
            var savePath = currentNotePath;
            if (!IsSupportedNotePath(savePath))
            {
                savePath = CreatePortableNotePath(requestedFileName);
                currentNotePath = savePath;
            }

            File.WriteAllText(savePath!, content, Encoding.UTF8);
            File.WriteAllText(Path.Combine(autosaveDirectory, "latest.owbn"), content, Encoding.UTF8);
            UpdatePortableSettings(savePath!);
            PostSaveResult(autosave, savePath, null);
        }
        catch (Exception error)
        {
            PostSaveResult(autosave, null, error.Message);
        }
    }

    private string CreatePortableNotePath(string? requestedFileName)
    {
        var safeFileName = string.IsNullOrWhiteSpace(requestedFileName)
            ? $"clearboard-note-{DateTime.Now:yyyyMMdd-HHmm}.owbn"
            : Path.GetFileName(requestedFileName);
        if (string.IsNullOrWhiteSpace(Path.GetExtension(safeFileName)))
        {
            safeFileName += ".owbn";
        }

        return Path.Combine(notesDirectory, safeFileName);
    }

    private PortableSettings LoadPortableSettings()
    {
        try
        {
            if (!File.Exists(settingsPath)) return new PortableSettings();
            return JsonSerializer.Deserialize<PortableSettings>(File.ReadAllText(settingsPath, Encoding.UTF8)) ?? new PortableSettings();
        }
        catch
        {
            return new PortableSettings();
        }
    }

    private void UpdatePortableSettings(string notePath)
    {
        var settings = LoadPortableSettings();
        settings.LastNotePath = notePath;
        settings.RecentNotes.RemoveAll(path => string.Equals(path, notePath, StringComparison.OrdinalIgnoreCase));
        settings.RecentNotes.Insert(0, notePath);
        if (settings.RecentNotes.Count > 12)
        {
            settings.RecentNotes.RemoveRange(12, settings.RecentNotes.Count - 12);
        }

        SavePortableSettings(settings);
    }

    private void SavePortableSettings(PortableSettings settings)
    {
        var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(settingsPath, json, Encoding.UTF8);
    }

    private void PostStartupInfo()
    {
        if (WhiteboardView.CoreWebView2 == null) return;
        if (startupInfoPosted) return;
        startupInfoPosted = true;
        var payload = JsonSerializer.Serialize(new
        {
            type = "app-startup",
            dataDirectory,
        });
        WhiteboardView.CoreWebView2.PostWebMessageAsJson(payload);
    }

    private void PostSaveResult(bool autosave, string? path, string? error)
    {
        if (WhiteboardView.CoreWebView2 == null) return;
        var payload = JsonSerializer.Serialize(new
        {
            type = autosave ? "autosave-note-file-result" : "save-note-file-result",
            path,
            error,
        });
        WhiteboardView.CoreWebView2.PostWebMessageAsJson(payload);
    }

    private sealed class PortableSettings
    {
        public string? LastNotePath { get; set; }
        public List<string> RecentNotes { get; set; } = new();
    }
}
