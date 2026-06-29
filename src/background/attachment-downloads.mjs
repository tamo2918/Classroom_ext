const FILE_TYPE_LABEL_PATTERN = [
  "Google ドキュメント",
  "Google スプレッドシート",
  "Google スライド",
  "Google 図形描画",
  "Microsoft Word",
  "Microsoft Excel",
  "Microsoft PowerPoint",
  "Document",
  "Spreadsheet",
  "Presentation",
  "PDF",
  "動画"
].join("|");
const FILE_EXTENSION_PATTERN = "pdf|docx?|xlsx?|pptx?|zip|csv|txt|mp4|mov|m4a";

export function buildAttachmentDownloadInfo(rawHref, rawTitle = "") {
  const url = parseAbsoluteUrl(rawHref);
  if (!url) {
    return null;
  }

  const unwrapped = unwrapGoogleRedirect(url) || url;
  const driveFileId = extractDriveFileId(unwrapped);
  if (driveFileId && !isDriveFolderUrl(unwrapped)) {
    return {
      downloadUrl: buildDriveDownloadUrl(driveFileId, unwrapped),
      filename: filenameOnlyWhenExtensionExists(rawTitle)
    };
  }

  const native = buildGoogleNativeExport(unwrapped, rawTitle);
  if (native) {
    return native;
  }

  return null;
}

function parseAbsoluteUrl(rawHref) {
  try {
    return new URL(String(rawHref || ""));
  } catch (_error) {
    return null;
  }
}

function unwrapGoogleRedirect(url) {
  if (!/(^|\.)google\./i.test(url.hostname) && url.hostname !== "classroom.google.com") {
    return null;
  }

  const nested = url.searchParams.get("url") || url.searchParams.get("q");
  if (!nested) {
    return null;
  }
  return parseAbsoluteUrl(nested);
}

function extractDriveFileId(url) {
  const pathMatch = url.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([^/]+)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const queryId = url.searchParams.get("id");
  if (queryId && /(^|\.)drive\.google\.com$/i.test(url.hostname)) {
    return queryId;
  }

  return "";
}

function isDriveFolderUrl(url) {
  return /\/folders\//.test(url.pathname) || url.pathname.includes("/drive/folders");
}

function buildDriveDownloadUrl(fileId, sourceUrl) {
  const downloadUrl = new URL("https://drive.google.com/uc");
  downloadUrl.searchParams.set("export", "download");
  downloadUrl.searchParams.set("id", fileId);
  downloadUrl.searchParams.set("confirm", "t");
  copySearchParam(sourceUrl, downloadUrl, "resourcekey");
  copySearchParam(sourceUrl, downloadUrl, "authuser");
  return downloadUrl.toString();
}

function buildGoogleNativeExport(url, rawTitle) {
  if (!/(^|\.)docs\.google\.com$/i.test(url.hostname)) {
    return null;
  }

  const match = url.pathname.match(/^\/(document|spreadsheets|presentation|drawings)\/d\/([^/]+)/);
  if (!match) {
    return null;
  }

  const [, kind, fileId] = match;
  const exportUrl = new URL(`https://docs.google.com/${kind}/d/${fileId}/export`);
  let extension = "pdf";
  if (kind === "spreadsheets") {
    exportUrl.searchParams.set("format", "xlsx");
    extension = "xlsx";
  } else if (kind === "presentation" || kind === "drawings") {
    exportUrl.pathname = `/${kind}/d/${fileId}/export/pdf`;
  } else {
    exportUrl.searchParams.set("format", "pdf");
  }

  copySearchParam(url, exportUrl, "resourcekey");
  copySearchParam(url, exportUrl, "authuser");

  return {
    downloadUrl: exportUrl.toString(),
    filename: filenameWithExtension(rawTitle, extension)
  };
}

function copySearchParam(sourceUrl, targetUrl, key) {
  const value = sourceUrl.searchParams.get(key);
  if (value) {
    targetUrl.searchParams.set(key, value);
  }
}

function filenameOnlyWhenExtensionExists(rawTitle) {
  const filename = sanitizeFilename(cleanAttachmentTitle(rawTitle));
  return /\.[a-z0-9]{2,8}$/i.test(filename) ? filename : "";
}

function filenameWithExtension(rawTitle, extension) {
  const base = sanitizeFilename(cleanAttachmentTitle(rawTitle)).replace(/\.[a-z0-9]{2,8}$/i, "");
  return base ? `${base}.${extension}` : "";
}

function cleanAttachmentTitle(rawTitle) {
  const title = String(rawTitle || "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = title.split(/\s*[:：]\s*/).filter(Boolean);
  if (/^(添付ファイル|attachment|attached file)$/i.test(parts[0] || "") && parts.length >= 3) {
    return stripTrailingFileTypeLabel(parts.slice(2).join(" "));
  }
  if (/^(添付ファイル|attachment|attached file)$/i.test(parts[0] || "") && parts.length >= 2) {
    return stripTrailingFileTypeLabel(parts.slice(1).join(" "));
  }
  return stripTrailingFileTypeLabel(title);
}

function stripTrailingFileTypeLabel(rawTitle) {
  let title = String(rawTitle || "").trim();
  for (let index = 0; index < 3; index += 1) {
    const nextTitle = title
      .replace(new RegExp(`\\.(${FILE_EXTENSION_PATTERN})\\s*(?:${FILE_TYPE_LABEL_PATTERN})$`, "i"), ".$1")
      .replace(new RegExp(`\\s+(?:${FILE_TYPE_LABEL_PATTERN})$`, "i"), "")
      .trim();
    if (nextTitle === title) {
      return title;
    }
    title = nextTitle;
  }
  return title;
}

function sanitizeFilename(filename) {
  return String(filename || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}
