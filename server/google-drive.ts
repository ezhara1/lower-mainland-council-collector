import { google } from "googleapis";
import { Readable } from "node:stream";
import type { AppSettings } from "./types.js";

const REDIRECT_URI = "http://localhost:8787/api/google/callback";

function oauthClient(settings: AppSettings) {
  if (!settings.googleClientId || !settings.googleClientSecret) {
    throw new Error("Google OAuth client ID and secret are required.");
  }
  const client = new google.auth.OAuth2(
    settings.googleClientId,
    settings.googleClientSecret,
    REDIRECT_URI,
  );
  if (settings.googleRefreshToken) {
    client.setCredentials({ refresh_token: settings.googleRefreshToken });
  }
  return client;
}

export function googleAuthUrl(settings: AppSettings) {
  return oauthClient(settings).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive.file"],
  });
}

export async function exchangeGoogleCode(
  settings: AppSettings,
  code: string,
) {
  const client = oauthClient(settings);
  const { tokens } = await client.getToken(code);
  return tokens.refresh_token ?? "";
}

async function findOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string,
) {
  const escaped = name.replace(/'/g, "\\'");
  const result = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    spaces: "drive",
  });
  if (result.data.files?.[0]?.id) return result.data.files[0].id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error(`Could not create Drive folder ${name}`);
  return created.data.id;
}

export async function uploadToDrive(
  settings: AppSettings,
  municipality: string,
  dateFolder: string,
  fileName: string,
  mimeType: string,
  bytes: Buffer,
) {
  if (!settings.googleDriveFolderId || !settings.googleRefreshToken) {
    throw new Error("Google Drive is not connected.");
  }
  const drive = google.drive({ version: "v3", auth: oauthClient(settings) });
  const cityFolder = await findOrCreateFolder(
    drive,
    municipality,
    settings.googleDriveFolderId,
  );
  const meetingFolder = await findOrCreateFolder(drive, dateFolder, cityFolder);
  const uploaded = await drive.files.create({
    requestBody: { name: fileName, parents: [meetingFolder] },
    media: { mimeType, body: Readable.from(bytes) },
    fields: "id,webViewLink",
  });
  return (
    uploaded.data.webViewLink ??
    `https://drive.google.com/open?id=${uploaded.data.id}`
  );
}
