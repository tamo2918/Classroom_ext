export function createMessageRouter(routes) {
  return (message, sender, sendResponse) => {
    if (!message || message.target === "offscreen") {
      return false;
    }

    const handler = Object.prototype.hasOwnProperty.call(routes, message.type)
      ? routes[message.type]
      : null;
    if (!handler) {
      return false;
    }

    Promise.resolve(handler(message, sender))
      .then(sendResponse)
      .catch((error) => sendResponse(toErrorResponse(error)));
    return true;
  };
}

export function toErrorResponse(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  };
}
