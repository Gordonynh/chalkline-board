using System.Reflection;
using System.Threading;
using System.Windows;

namespace OpenWhiteboardDesktop;

public partial class App : Application
{
    private Mutex? singleInstanceMutex;
    private bool ownsSingleInstanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        var assemblyName = Assembly.GetExecutingAssembly().GetName().Name ?? "ChalklineBoard";
        singleInstanceMutex = new Mutex(true, $@"Local\{assemblyName}.SingleInstance", out var createdNew);
        ownsSingleInstanceMutex = createdNew;
        if (!createdNew)
        {
            singleInstanceMutex.Dispose();
            singleInstanceMutex = null;
            Shutdown();
            return;
        }

        base.OnStartup(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (ownsSingleInstanceMutex)
        {
            singleInstanceMutex?.ReleaseMutex();
        }
        singleInstanceMutex?.Dispose();
        singleInstanceMutex = null;
        ownsSingleInstanceMutex = false;
        base.OnExit(e);
    }
}
