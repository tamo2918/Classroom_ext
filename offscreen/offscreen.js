chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen" || message?.type !== "CLT_WRITE_CLIPBOARD") {
    return false;
  }

  (async () => {
    if (typeof message.text !== "string" || message.text.length === 0) {
      throw new Error("Clipboard text is empty.");
    }

    await writeClipboardText(message.text);
    return { ok: true };
  })()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

async function writeClipboardText(text) {
  let clipboardApiError = null;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (error) {
    clipboardApiError = error;
  }

  if (copyWithExecCommand(text)) {
    return;
  }

  if (clipboardApiError) {
    throw clipboardApiError;
  }
  throw new Error("document.execCommand('copy') failed.");
}

function copyWithExecCommand(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "width:1px",
    "height:1px",
    "opacity:0",
    "pointer-events:none"
  ].join(";");

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}
