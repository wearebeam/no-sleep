const { webm, mp4 } = require("./media.js");

// Detect native Wake Lock API support
const nativeWakeLock = () => "wakeLock" in navigator &&
  // As of iOS 17.0.3, PWA mode does not support nativeWakeLock.
  // See <https://bugs.webkit.org/show_bug.cgi?id=254545>
  !window.matchMedia('(display-mode: standalone)').matches;

class NoSleep {
  constructor() {
    this.enabled = false;
    if (nativeWakeLock()) {
      this._wakeLock = null;
      const handleVisibilityChange = () => {
        if (this._wakeLock !== null && document.visibilityState === "visible") {
          this.enable().catch(() => {});
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      document.addEventListener("fullscreenchange", handleVisibilityChange);
    } else {
      // Set up no sleep video element
      this.noSleepVideo = document.createElement("video");

      this.noSleepVideo.setAttribute("title", "No Sleep");
      this.noSleepVideo.setAttribute("playsinline", "");
      this.noSleepVideo.muted = true;

      this._addSourceToVideo(this.noSleepVideo, "webm", webm);
      this._addSourceToVideo(this.noSleepVideo, "mp4", mp4);

      // For iOS >15 video needs to be on the document to work as a wake lock
      Object.assign(this.noSleepVideo.style, {
        position: "absolute",
        left: "-100%",
        top: "-100%",
      });
      document.querySelector("body").append(this.noSleepVideo);

      this.noSleepVideo.addEventListener("loadedmetadata", () => {
        if (this.noSleepVideo.duration <= 1) {
          // webm source
          this.noSleepVideo.setAttribute("loop", "");
        } else {
          // mp4 source
          this.noSleepVideo.addEventListener("timeupdate", () => {
            if (this.noSleepVideo.currentTime > 0.5) {
              this.noSleepVideo.currentTime = Math.random();
            }
          });
        }
      });
    }
  }

  _addSourceToVideo(element, type, dataURI) {
    var source = document.createElement("source");
    source.src = dataURI;
    source.type = `video/${type}`;
    element.appendChild(source);
  }

  get isEnabled() {
    return this.enabled;
  }

  enable() {
    if (nativeWakeLock()) {
      return navigator.wakeLock
        .request("screen")
        .then((wakeLock) => {
          this._wakeLock = wakeLock;
          this.enabled = true;
          console.log("Wake Lock active.");
          this._wakeLock.addEventListener("release", () => {
            // ToDo: Potentially emit an event for the page to observe since
            // Wake Lock releases happen when page visibility changes.
            // (https://web.dev/wakelock/#wake-lock-lifecycle)
            console.log("Wake Lock released.");
          });
        })
        .catch((err) => {
          this.enabled = false;
          console.error(`${err.name}, ${err.message}`);
          throw err;
        });
    } else {
      let playPromise = this.noSleepVideo.play();
      return playPromise
        .then((res) => {
          this.enabled = true;
          return res;
        })
        .catch((err) => {
          this.enabled = false;
          throw err;
        });
    }
  }

  disable() {
    if (nativeWakeLock()) {
      if (this._wakeLock) {
        this._wakeLock.release();
      }
      this._wakeLock = null;
    } else {
      this.noSleepVideo.pause();
    }
    this.enabled = false;
  }
}

module.exports = NoSleep;
