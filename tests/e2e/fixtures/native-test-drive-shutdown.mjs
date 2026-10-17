if (process.env.NODE_ENV === "test" && process.env.IN_FEED_TEST_DRIVE_SHUTDOWN === "1" && typeof process.send === "function") {
  process.on("message", (message) => {
    if (message?.type === "paperclip-e2e-shutdown") {
      if (process.listenerCount("SIGTERM") === 0) throw new Error("Paperclip shutdown handler is not registered");
      process.emit("SIGTERM");
    }
  });
}
