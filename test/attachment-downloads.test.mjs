import assert from "node:assert/strict";
import { buildAttachmentDownloadInfo } from "../src/background/attachment-downloads.mjs";

const drivePdfUrl = "https://drive.google.com/file/d/drive-file-id/view?usp=classroom_web&authuser=0";
const driveVideoUrl = "https://drive.google.com/file/d/drive-video-id/view?usp=classroom_web&authuser=0";
const docsUrl = "https://docs.google.com/document/d/document-id/edit?usp=classroom_web&authuser=0";

assert.equal(
  buildAttachmentDownloadInfo(drivePdfUrl, "添付ファイル: PDF: 第１２回 平面と直線の方程式.pdfPDF").filename,
  "第１２回 平面と直線の方程式.pdf"
);

assert.equal(
  buildAttachmentDownloadInfo(drivePdfUrl, "実習資料：第10回-繰り返し.pdf PDF").filename,
  "実習資料：第10回-繰り返し.pdf"
);

assert.equal(
  buildAttachmentDownloadInfo(driveVideoUrl, "BPP1_10_実習説明.mp4動画").filename,
  "BPP1_10_実習説明.mp4"
);

assert.equal(
  buildAttachmentDownloadInfo(docsUrl, "添付ファイル: Google ドキュメント: レポート Google ドキュメント").filename,
  "レポート.pdf"
);
