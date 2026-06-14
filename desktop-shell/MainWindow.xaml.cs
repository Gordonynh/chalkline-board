using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace OpenWhiteboardDesktop;

public partial class MainWindow : Window
{
    private sealed record AppVariantIdentity(
        string AppId,
        string Kind,
        string PackageDir,
        bool IncludesTextbookResources,
        string AssemblyName,
        string Title,
        string HostName);

    private sealed record VariantMarker(
        string AppId,
        string Kind,
        string PackageDir,
        bool IncludesTextbookResources);

    private readonly string? pendingNotePath;
    private readonly List<string> pendingImportPaths;
    private readonly string executableDirectory;
    private readonly string dataDirectory;
    private readonly string notesDirectory;
    private readonly string autosaveDirectory;
    private readonly string settingsPath;
    private string? currentNotePath;
    private bool pendingStartupFilesProcessed;
    private bool startupInfoPosted;

    private static readonly string ActualAssemblyName =
        Assembly.GetExecutingAssembly().GetName().Name ?? "ChalklineBoard";

    private static readonly string? RequestedAppKind = ReadRequestedAppKind(Environment.GetCommandLineArgs());

    private static readonly AppVariantIdentity AppVariant = ResolveAppVariantIdentity();

    private static readonly string AppAssemblyName = AppVariant.AssemblyName;

    private static readonly string AppTitle = AppVariant.Title;

    private static readonly string ExpectedAppKind = AppVariant.Kind;

    private static readonly string ExpectedAppId = AppVariant.AppId;

    private static readonly string ExpectedPackageDir = AppVariant.PackageDir;

    private static readonly bool ExpectedTextbookResources = AppVariant.IncludesTextbookResources;

    private static readonly string HostName = AppVariant.HostName;

    private static readonly string DataDirectoryName =
        $"{AppAssemblyName}_Data";

    private static AppVariantIdentity ResolveAppVariantIdentity()
    {
        if (!string.IsNullOrWhiteSpace(RequestedAppKind))
        {
            return IdentityFromKind(RequestedAppKind);
        }

        var externalMarker = ReadVariantMarker(Path.Combine(AppContext.BaseDirectory, "app", "variant.json"));
        var embeddedMarker = ReadEmbeddedVariantMarker();
#if SINGLE_FILE_PUBLISH
        var marker = embeddedMarker ?? externalMarker;
#else
        var marker = externalMarker ?? embeddedMarker;
#endif

        return marker is null
            ? IdentityFromAssemblyName(ActualAssemblyName)
            : IdentityFromMarker(marker);
    }

    private static string? ReadRequestedAppKind(string[] args)
    {
        for (var index = 1; index < args.Length; index++)
        {
            var arg = args[index];
            var value = arg.StartsWith("--app=", StringComparison.OrdinalIgnoreCase)
                ? arg["--app=".Length..]
                : arg.StartsWith("--variant=", StringComparison.OrdinalIgnoreCase)
                    ? arg["--variant=".Length..]
                    : arg.StartsWith("--kind=", StringComparison.OrdinalIgnoreCase)
                        ? arg["--kind=".Length..]
                        : null;
            if (value == null && IsAppKindOption(arg) && index + 1 < args.Length)
            {
                value = args[++index];
            }
            if (string.IsNullOrWhiteSpace(value)) continue;

            return value.Trim().ToLowerInvariant() switch
            {
                "blank" or "chalkline" or "board" or "whiteboard" => "blank",
                "textbook" or "book" => "textbook",
                "visualizer" or "projection" or "projector" => "visualizer",
                _ => null,
            };
        }

        return null;
    }

    private static bool IsAppKindOption(string arg)
    {
        return
            string.Equals(arg, "--app", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(arg, "--variant", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(arg, "--kind", StringComparison.OrdinalIgnoreCase);
    }

    private static AppVariantIdentity IdentityFromMarker(VariantMarker marker)
    {
        var kind = marker.Kind switch
        {
            "textbook" => "textbook",
            "visualizer" => "visualizer",
            _ => "blank",
        };
        return IdentityFromKind(kind);
    }

    private static AppVariantIdentity IdentityFromAssemblyName(string assemblyName)
    {
        return assemblyName switch
        {
            "ChalklineTextbook" => IdentityFromKind("textbook"),
            "ChalklineVisualizer" => IdentityFromKind("visualizer"),
            _ => IdentityFromKind("blank"),
        };
    }

    private static AppVariantIdentity IdentityFromKind(string kind)
    {
        return kind switch
        {
            "textbook" => new AppVariantIdentity(
                "textbook",
                "textbook",
                "chalkline-textbook",
                true,
                "ChalklineTextbook",
                "Chalkline Textbook",
                "chalkline-textbook.local"),
            "visualizer" => new AppVariantIdentity(
                "visualizer",
                "visualizer",
                "chalkline-visualizer",
                false,
                "ChalklineVisualizer",
                "Chalkline Visualizer",
                "chalkline-visualizer.local"),
            _ => new AppVariantIdentity(
                "chalkline",
                "blank",
                "chalkline-board",
                false,
                "ChalklineBoard",
                "Chalkline Board",
                "chalkline-board.local"),
        };
    }

    private static VariantMarker? ReadEmbeddedVariantMarker()
    {
        try
        {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("app/variant.json");
            if (stream == null) return null;
            using var reader = new StreamReader(stream, Encoding.UTF8);
            return ParseVariantMarker(reader.ReadToEnd());
        }
        catch
        {
            return null;
        }
    }

    private static VariantMarker? ReadVariantMarker(string markerPath)
    {
        try
        {
            return File.Exists(markerPath)
                ? ParseVariantMarker(File.ReadAllText(markerPath, Encoding.UTF8))
                : null;
        }
        catch
        {
            return null;
        }
    }

    private static VariantMarker? ParseVariantMarker(string markerJson)
    {
        using var document = JsonDocument.Parse(markerJson);
        var root = document.RootElement;
        var appId = root.TryGetProperty("appId", out var appIdProperty) ? appIdProperty.GetString() : null;
        var kind = root.TryGetProperty("kind", out var kindProperty) ? kindProperty.GetString() : null;
        var packageDir = root.TryGetProperty("packageDir", out var packageDirProperty) ? packageDirProperty.GetString() : null;
        var includesTextbookResources =
            root.TryGetProperty("includesTextbookResources", out var textbookProperty) &&
            textbookProperty.ValueKind == JsonValueKind.True;

        if (string.IsNullOrWhiteSpace(appId) || string.IsNullOrWhiteSpace(kind) || string.IsNullOrWhiteSpace(packageDir))
        {
            return null;
        }

        return new VariantMarker(appId, kind, packageDir, includesTextbookResources);
    }

    public MainWindow()
    {
        InitializeComponent();
        StartupTitle.Text = $"{AppTitle} \u6b63\u5728\u542f\u52a8";
        executableDirectory = GetExecutableDirectory();
        dataDirectory = Path.Combine(executableDirectory, DataDirectoryName);
        notesDirectory = Path.Combine(dataDirectory, "notes");
        autosaveDirectory = Path.Combine(dataDirectory, "autosave");
        settingsPath = Path.Combine(dataDirectory, "settings.json");
        var pendingPaths = Environment.GetCommandLineArgs().Skip(1).Where(File.Exists).ToArray();
        pendingNotePath = pendingPaths.FirstOrDefault(IsSupportedNotePath);
        pendingImportPaths = pendingPaths.Where(IsSupportedImportPath).ToList();
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

        string appFolder;
        try
        {
            appFolder = ResolveAppFolder();
        }
        catch (Exception error)
        {
            MessageBox.Show(
                $"Desktop app assets could not be loaded.\n\n{error.Message}",
                AppTitle,
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Close();
            return;
        }

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
        await ClearWebViewAssetCacheAsync();
        WhiteboardView.CoreWebView2.WebMessageReceived += HandleWebMessageReceived;
        WhiteboardView.CoreWebView2.NewWindowRequested += (_, args) => args.Handled = true;
        WhiteboardView.CoreWebView2.NavigationCompleted += async (_, _) =>
        {
            StartupOverlay.Visibility = Visibility.Collapsed;
            await OpenStartupFileAfterLoadAsync();
        };

        WhiteboardView.Source = BuildAppUri(appFolder);
        WhiteboardView.Focus();
    }

    private async Task ClearWebViewAssetCacheAsync()
    {
        try
        {
            await WhiteboardView.CoreWebView2.CallDevToolsProtocolMethodAsync("Network.clearBrowserCache", "{}");
        }
        catch
        {
            // Cache clearing is best-effort; the versioned URL below is the hard guard.
        }
    }

    private static Uri BuildAppUri(string appFolder)
    {
        var version = AppAssemblyName;
        var markerPath = Path.Combine(appFolder, ".asset-version");
        if (File.Exists(markerPath))
        {
            try
            {
                version = File.ReadAllText(markerPath, Encoding.UTF8).Trim();
            }
            catch
            {
                version = AppAssemblyName;
            }
        }
        else
        {
            var indexPath = Path.Combine(appFolder, "index.html");
            if (File.Exists(indexPath))
            {
                version = $"{AppAssemblyName}|{File.GetLastWriteTimeUtc(indexPath).Ticks}";
            }
        }

        return new Uri($"https://{HostName}/index.html?v={BuildAssetVersionToken(version)}");
    }

    private static string BuildAssetVersionToken(string version)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(version));
        return Convert.ToHexString(bytes).ToLowerInvariant()[..16];
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
            OpenStartupFile();
            return;
        }

        TryHandleJsonCommand(command);
    }

    private async Task OpenStartupFileAfterLoadAsync()
    {
        await Task.Delay(250);
        OpenStartupFile();
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

            if (type == "convert-office-file")
            {
                var fileName = root.TryGetProperty("fileName", out var fileNameProperty)
                    ? fileNameProperty.GetString()
                    : null;
                var content = root.TryGetProperty("content", out var contentProperty)
                    ? contentProperty.GetString()
                    : null;
                var preserveCurrentPages =
                    root.TryGetProperty("preserveCurrentPages", out var preserveCurrentPagesProperty) &&
                    preserveCurrentPagesProperty.ValueKind == JsonValueKind.True;
                _ = ConvertOfficeFileAsync(fileName, content, preserveCurrentPages);
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

    private static bool IsSupportedImportPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path) || IsSupportedNotePath(path)) return false;
        var extension = Path.GetExtension(path).ToLowerInvariant();
        return extension is ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif" or ".bmp" or ".avif" or ".svg" or ".pdf" or
            ".ppt" or ".pps" or ".pot" or ".pptx" or ".pptm" or ".ppsx" or ".ppsm" or ".potx" or ".potm" or ".odp" or
            ".doc" or ".dot" or ".rtf" or ".docx" or ".docm" or ".dotx" or ".dotm" or ".odt" or
            ".xls" or ".xlsx" or ".xlsm" or ".xltx" or ".xltm" or ".ods" or
            ".txt" or ".md" or ".csv" or ".tsv" or ".json" or ".html" or ".htm" or ".xml" or ".log";
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
#if SINGLE_FILE_PUBLISH
        return ExtractEmbeddedAppAssets();
#else
        var externalAppFolder = Path.Combine(AppContext.BaseDirectory, "app");
        if (IsExpectedAppFolder(externalAppFolder))
        {
            return externalAppFolder;
        }

        return ExtractEmbeddedAppAssets();
#endif
    }

    private static bool IsExpectedAppFolder(string folder)
    {
        var indexPath = Path.Combine(folder, "index.html");
        var markerPath = Path.Combine(folder, "variant.json");
        if (!File.Exists(indexPath) || !File.Exists(markerPath)) return false;

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(markerPath, Encoding.UTF8));
            var root = document.RootElement;
            var appId = root.TryGetProperty("appId", out var appIdProperty) ? appIdProperty.GetString() : null;
            var kind = root.TryGetProperty("kind", out var kindProperty) ? kindProperty.GetString() : null;
            var packageDir = root.TryGetProperty("packageDir", out var packageDirProperty) ? packageDirProperty.GetString() : null;
            var includesTextbookResources =
                root.TryGetProperty("includesTextbookResources", out var textbookProperty) &&
                textbookProperty.ValueKind == JsonValueKind.True;
            return
                string.Equals(appId, ExpectedAppId, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(kind, ExpectedAppKind, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(packageDir, ExpectedPackageDir, StringComparison.OrdinalIgnoreCase) &&
                includesTextbookResources == ExpectedTextbookResources &&
                FolderResourcePolicyMatches(folder) &&
                FolderBundlePolicyMatches(folder);
        }
        catch
        {
            return false;
        }
    }

    private static bool FolderResourcePolicyMatches(string folder)
    {
        var hasTextbookResources =
            File.Exists(Path.Combine(folder, "book", "001.jpg")) &&
            File.Exists(Path.Combine(folder, "book-110", "001.jpg"));

        if (ExpectedTextbookResources)
        {
            return hasTextbookResources;
        }

        return
            !Directory.Exists(Path.Combine(folder, "book")) &&
            !Directory.Exists(Path.Combine(folder, "book-110"));
    }

    private static bool FolderBundlePolicyMatches(string folder)
    {
        var hasTextbookMarker = BundleContains(folder, "textbook-main");
        var hasVisualizerMarker = BundleContains(folder, "visualizer-shell");
        var hasWhiteboardMarker = BundleContains(folder, "whiteboard-app");
        var hasWhiteboardOnlyMarker =
            hasWhiteboardMarker ||
            BundleContains(folder, "book-picker") ||
            BundleContains(folder, "open-whiteboard-selected-book");

        return ExpectedAppKind switch
        {
            "textbook" => hasTextbookMarker && !hasVisualizerMarker,
            "visualizer" => hasVisualizerMarker && !hasTextbookMarker && !hasWhiteboardOnlyMarker,
            _ => hasWhiteboardMarker && !hasTextbookMarker && !hasVisualizerMarker,
        };
    }

    private static bool BundleContains(string folder, string marker)
    {
        var assetDirectory = Path.Combine(folder, "assets");
        if (!Directory.Exists(assetDirectory)) return false;

        try
        {
            foreach (var scriptPath in Directory.EnumerateFiles(assetDirectory, "*.js", SearchOption.TopDirectoryOnly))
            {
                if (File.ReadAllText(scriptPath, Encoding.UTF8).Contains(marker, StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }
        catch
        {
            return false;
        }

        return false;
    }

    private string ExtractEmbeddedAppAssets()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resources = assembly
            .GetManifestResourceNames()
            .Where(name => name.StartsWith("app/", StringComparison.OrdinalIgnoreCase))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();
        var cacheDirectory = Path.Combine(dataDirectory, "app-cache");
        var markerPath = Path.Combine(cacheDirectory, ".asset-version");
        var version = $"{AppAssemblyName}|{ExpectedAppKind}|{assembly.ManifestModule.ModuleVersionId:N}|{string.Join('|', resources)}";

        if (
            IsExpectedAppFolder(cacheDirectory) &&
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
            var relativePath = resourceName["app/".Length..]
                .Replace('/', Path.DirectorySeparatorChar)
                .Replace('\\', Path.DirectorySeparatorChar);
            if (string.IsNullOrWhiteSpace(relativePath)) continue;

            var destinationPath = Path.Combine(cacheDirectory, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
            using var resourceStream = assembly.GetManifestResourceStream(resourceName);
            if (resourceStream == null) continue;
            using var fileStream = File.Create(destinationPath);
            resourceStream.CopyTo(fileStream);
        }

        File.WriteAllText(markerPath, version, Encoding.UTF8);
        if (!IsExpectedAppFolder(cacheDirectory))
        {
            throw new InvalidOperationException($"Packaged app assets do not match {ExpectedAppKind}.");
        }

        return cacheDirectory;
    }

    private void OpenStartupFile()
    {
        if (pendingStartupFilesProcessed) return;
        pendingStartupFilesProcessed = true;
        if (OpenStartupNoteFile(includePendingImports: true)) return;
        OpenPendingImportFile();
    }

    private bool OpenPendingImportFile()
    {
        if (pendingImportPaths.Count == 0) return false;
        try
        {
            var payload = JsonSerializer.Serialize(new
            {
                type = "open-import-file",
                files = pendingImportPaths.Select(path => new
                {
                    fileName = Path.GetFileName(path),
                    content = $"data:{MimeTypeForPath(path)};base64,{Convert.ToBase64String(File.ReadAllBytes(path))}",
                }).ToArray(),
            });
            WhiteboardView.CoreWebView2.PostWebMessageAsJson(payload);
            return true;
        }
        catch (Exception error)
        {
            PostConvertOfficeResult(null, null, $"Startup file could not be imported. {error.Message}");
            return false;
        }
    }

    private bool OpenStartupNoteFile(bool includePendingImports = false)
    {
        var settings = LoadPortableSettings();
        var notePath = IsSupportedNotePath(pendingNotePath)
            ? pendingNotePath
            : ExpectedAppKind == "textbook" || ExpectedAppKind == "visualizer"
                ? null
                : settings.LastNotePath;
        if (!IsSupportedNotePath(notePath)) return false;

        try
        {
            currentNotePath = notePath;
            UpdatePortableSettings(notePath!);
            var payload = JsonSerializer.Serialize(new
            {
                type = "open-note-file",
                fileName = Path.GetFileName(notePath!),
                content = File.ReadAllText(notePath!, Encoding.UTF8),
                files = includePendingImports ? pendingImportPaths.Select(path => new
                {
                    fileName = Path.GetFileName(path),
                    content = $"data:{MimeTypeForPath(path)};base64,{Convert.ToBase64String(File.ReadAllBytes(path))}",
                }).ToArray() : null,
            });
            WhiteboardView.CoreWebView2.PostWebMessageAsJson(payload);
            return true;
        }
        catch (Exception error)
        {
            MessageBox.Show(
                $"Whiteboard note file could not be opened.\n\n{error.Message}",
                AppTitle,
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            return false;
        }
    }

    private static string MimeTypeForPath(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".bmp" => "image/bmp",
            ".avif" => "image/avif",
            ".svg" => "image/svg+xml",
            ".pdf" => "application/pdf",
            ".ppt" => "application/vnd.ms-powerpoint",
            ".pps" => "application/vnd.ms-powerpoint",
            ".pot" => "application/vnd.ms-powerpoint",
            ".pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ".pptm" => "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
            ".ppsx" => "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
            ".ppsm" => "application/vnd.ms-powerpoint.slideshow.macroEnabled.12",
            ".potx" => "application/vnd.openxmlformats-officedocument.presentationml.template",
            ".potm" => "application/vnd.ms-powerpoint.template.macroEnabled.12",
            ".odp" => "application/vnd.oasis.opendocument.presentation",
            ".doc" => "application/msword",
            ".dot" => "application/msword",
            ".rtf" => "application/rtf",
            ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".docm" => "application/vnd.ms-word.document.macroEnabled.12",
            ".dotx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
            ".dotm" => "application/vnd.ms-word.template.macroEnabled.12",
            ".odt" => "application/vnd.oasis.opendocument.text",
            ".xls" => "application/vnd.ms-excel",
            ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".xlsm" => "application/vnd.ms-excel.sheet.macroEnabled.12",
            ".xltx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
            ".xltm" => "application/vnd.ms-excel.template.macroEnabled.12",
            ".ods" => "application/vnd.oasis.opendocument.spreadsheet",
            ".txt" => "text/plain",
            ".md" => "text/markdown",
            ".csv" => "text/csv",
            ".tsv" => "text/tab-separated-values",
            ".json" => "application/json",
            ".html" or ".htm" => "text/html",
            ".xml" => "application/xml",
            ".log" => "text/plain",
            _ => "application/octet-stream",
        };
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

    private async Task ConvertOfficeFileAsync(string? requestedFileName, string? dataUrl, bool preserveCurrentPages)
    {
        if (string.IsNullOrWhiteSpace(requestedFileName) || string.IsNullOrWhiteSpace(dataUrl))
        {
            PostConvertOfficeResult(null, null, "Office file content is empty.", preserveCurrentPages);
            return;
        }

        var sofficePath = FindSofficePath();
        if (string.IsNullOrWhiteSpace(sofficePath))
        {
            PostConvertOfficeResult(
                null,
                null,
                "Office conversion requires LibreOffice. Install LibreOffice or convert to PPTX, DOCX, or XLSX first.",
                preserveCurrentPages);
            return;
        }

        var extension = Path.GetExtension(requestedFileName).ToLowerInvariant();
        var targetExtension = extension switch
        {
            ".ppt" => "pptx",
            ".pps" => "pptx",
            ".pot" => "pptx",
            ".odp" => "pptx",
            ".doc" => "docx",
            ".dot" => "docx",
            ".rtf" => "docx",
            ".odt" => "docx",
            ".xls" => "xlsx",
            ".ods" => "xlsx",
            _ => null,
        };
        if (targetExtension == null)
        {
            PostConvertOfficeResult(null, null, "Unsupported Office conversion file type.", preserveCurrentPages);
            return;
        }

        var tempRoot = Path.Combine(dataDirectory, "office-convert", Guid.NewGuid().ToString("N"));
        var inputDirectory = Path.Combine(tempRoot, "input");
        var outputDirectory = Path.Combine(tempRoot, "output");
        try
        {
            var result = await Task.Run(() => ConvertOfficeFileWithLibreOffice(
                sofficePath,
                requestedFileName,
                dataUrl,
                targetExtension,
                inputDirectory,
                outputDirectory));
            PostConvertOfficeResult(result.FileName, result.Content, result.Error, preserveCurrentPages);
        }
        catch (Exception error)
        {
            PostConvertOfficeResult(null, null, error.Message, preserveCurrentPages);
        }
        finally
        {
            try
            {
                if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, true);
            }
            catch
            {
                // Temporary files are best-effort cleanup.
            }
        }
    }

    private static ConvertOfficeResult ConvertOfficeFileWithLibreOffice(
        string sofficePath,
        string requestedFileName,
        string dataUrl,
        string targetExtension,
        string inputDirectory,
        string outputDirectory)
    {
        Directory.CreateDirectory(inputDirectory);
        Directory.CreateDirectory(outputDirectory);

        var inputPath = Path.Combine(inputDirectory, Path.GetFileName(requestedFileName));
        File.WriteAllBytes(inputPath, DecodeDataUrl(dataUrl));

        var startInfo = new ProcessStartInfo
        {
            FileName = sofficePath,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        startInfo.ArgumentList.Add("--headless");
        startInfo.ArgumentList.Add("--convert-to");
        startInfo.ArgumentList.Add(targetExtension);
        startInfo.ArgumentList.Add("--outdir");
        startInfo.ArgumentList.Add(outputDirectory);
        startInfo.ArgumentList.Add(inputPath);

        using var process = Process.Start(startInfo);
        if (process == null)
        {
            return new ConvertOfficeResult(null, null, "LibreOffice conversion could not be started.");
        }

        if (!process.WaitForExit(90000))
        {
            try { process.Kill(true); } catch { }
            return new ConvertOfficeResult(null, null, "Office conversion timed out.");
        }

        if (process.ExitCode != 0)
        {
            return new ConvertOfficeResult(null, null, $"Office conversion failed with exit code {process.ExitCode}.");
        }

        var outputPath = Directory
            .GetFiles(outputDirectory, "*" + targetExtension, SearchOption.TopDirectoryOnly)
            .FirstOrDefault();
        if (string.IsNullOrWhiteSpace(outputPath) || !File.Exists(outputPath))
        {
            return new ConvertOfficeResult(null, null, "Office conversion did not produce an output file.");
        }

        var convertedFileName = Path.ChangeExtension(Path.GetFileName(requestedFileName), targetExtension);
        var mimeType = targetExtension switch
        {
            "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            _ => "application/octet-stream",
        };
        var convertedDataUrl = $"data:{mimeType};base64,{Convert.ToBase64String(File.ReadAllBytes(outputPath))}";
        return new ConvertOfficeResult(convertedFileName, convertedDataUrl, null);
    }

    private static byte[] DecodeDataUrl(string dataUrl)
    {
        var commaIndex = dataUrl.IndexOf(',');
        var payload = commaIndex >= 0 ? dataUrl[(commaIndex + 1)..] : dataUrl;
        return Convert.FromBase64String(payload);
    }

    private static string? FindSofficePath()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "LibreOffice", "program", "soffice.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "LibreOffice", "program", "soffice.exe"),
        };
        var installed = candidates.FirstOrDefault(File.Exists);
        if (!string.IsNullOrWhiteSpace(installed)) return installed;

        var pathValue = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(pathValue)) return null;
        foreach (var directory in pathValue.Split(Path.PathSeparator))
        {
            if (string.IsNullOrWhiteSpace(directory)) continue;
            var candidate = Path.Combine(directory.Trim(), "soffice.exe");
            if (File.Exists(candidate)) return candidate;
        }

        return null;
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

    private void PostConvertOfficeResult(string? fileName, string? content, string? error, bool preserveCurrentPages = false)
    {
        if (WhiteboardView.CoreWebView2 == null) return;
        var payload = JsonSerializer.Serialize(new
        {
            type = string.IsNullOrWhiteSpace(error) ? "converted-office-file" : "convert-office-file-result",
            fileName,
            content,
            error,
            preserveCurrentPages,
        });
        WhiteboardView.CoreWebView2.PostWebMessageAsJson(payload);
    }

    private sealed class PortableSettings
    {
        public string? LastNotePath { get; set; }
        public List<string> RecentNotes { get; set; } = new();
    }

    private sealed record ConvertOfficeResult(string? FileName, string? Content, string? Error);
}
