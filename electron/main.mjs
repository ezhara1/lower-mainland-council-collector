import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, shell } from "electron";

const port = Number(process.env.COLLECTOR_PORT ?? 8787);
const appUrl = `http://localhost:${port}`;

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The collector service did not start.");
}

function openOutsideApp(url) {
  if (url.startsWith(appUrl)) return false;
  shell.openExternal(url);
  return true;
}

async function createWindow() {
  const appDir = app.getAppPath();
  process.env.NODE_ENV = "production";
  process.env.PORT = String(port);
  process.env.COLLECTOR_APP_DIR = appDir;
  process.env.COLLECTOR_DATA_DIR = path.join(app.getPath("userData"), "data");
  await import(pathToFileURL(path.join(appDir, "dist-server", "index.js")).href);
  await waitForServer();

  const window = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    title: "Lower Mainland Council Collector",
    backgroundColor: "#0f2a22",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutsideApp(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (openOutsideApp(url)) event.preventDefault();
  });
  await window.loadURL(appUrl);
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "Council Collector failed to start",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());
