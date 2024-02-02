import { mp4, webm } from './media';

export interface INoSleep {
  isEnabled: boolean;
  enable(): Promise<void>;
  disable(): void;
}

class NoSleepSSR implements INoSleep {
  isEnabled = false;
  enable(): Promise<void> {
    throw new Error('NoSleep using SSR/no-op mode; do not call enable.');
  }
  disable() {
    throw new Error('NoSleep using SSR/no-op mode; do not call disable.');
  }
}

class NoSleepNative implements INoSleep {
  isEnabled = false;
  wakeLock?: WakeLockSentinel;

  constructor() {
    const handleVisibilityChange = () =>
      this.wakeLock && document.visibilityState === 'visible' && this.enable();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleVisibilityChange);
  }

  async enable() {
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.isEnabled = true;
      console.debug('Wake Lock active.');
      this.wakeLock.addEventListener('release', () => {
        // TODO: Potentially emit an event for the page to observe since
        // Wake Lock releases happen when page visibility changes.
        // (https://web.dev/wakelock/#wake-lock-lifecycle)
        console.debug('Wake Lock released.');
      });
    } catch (err) {
      this.isEnabled = false;
      if (err instanceof Error) console.error(`${err.name}, ${err.message}`);
    }
  }

  disable() {
    this.wakeLock?.release();
    this.wakeLock = undefined;
    this.isEnabled = false;
  }
}

class NoSleepVideo implements INoSleep {
  isEnabled = false;
  noSleepVideo: HTMLVideoElement;

  constructor(options?: {
    videoTitle?: string;
    videoSourceType?: 'webm' | 'mp4';
  }) {
    // Set up no sleep video element
    this.noSleepVideo = document.createElement('video');

    const videoTitle = options?.videoTitle || 'No Sleep';
    this.noSleepVideo.setAttribute('title', videoTitle);
    this.noSleepVideo.setAttribute('playsinline', '');

    if (options?.videoSourceType === 'webm' || !options?.videoSourceType) {
      this._addSourceToVideo(this.noSleepVideo, 'webm', webm);
    }

    if (options?.videoSourceType === 'mp4' || !options?.videoSourceType) {
      this._addSourceToVideo(this.noSleepVideo, 'mp4', mp4);
    }

    // For iOS >15 video needs to be on the document to work as a wake lock
    Object.assign(this.noSleepVideo.style, {
      position: 'absolute',
      left: '-100%',
      top: '-100%',
    });
    document.querySelector('body')?.append(this.noSleepVideo);

    this.noSleepVideo.addEventListener('loadedmetadata', () => {
      this.noSleepVideo.addEventListener('timeupdate', () => {
        if (this.noSleepVideo.currentTime > 0.5) {
          this.noSleepVideo.currentTime = Math.random() * 0.5;
        }
      });
    });
  }

  _addSourceToVideo(
    element: HTMLVideoElement,
    type: 'webm' | 'mp4',
    dataURI: string,
  ) {
    const source = document.createElement('source');
    source.src = dataURI;
    source.type = `video/${type}`;
    element.appendChild(source);
  }

  async enable() {
    const playPromise = this.noSleepVideo.play();
    try {
      const res = await playPromise;
      this.isEnabled = true;
      return res;
    } catch (err) {
      this.isEnabled = false;
      if (err instanceof Error) console.error(`${err.name}, ${err.message}`);
    }
  }

  disable() {
    this.noSleepVideo.pause();
    this.isEnabled = false;
  }
}

// Detect native Wake Lock API support
const defaultExport: {
  new (options?: {
    videoTitle?: string;
    videoSourceType?: 'webm' | 'mp4';
  }): INoSleep;
} =
  typeof navigator === 'undefined'
    ? NoSleepSSR
    : // As of iOS 17.0.3, PWA mode does not support nativeWakeLock.
    // See <https://bugs.webkit.org/show_bug.cgi?id=254545>
    // @ts-expect-error: using non-standard standalone property
    'wakeLock' in navigator && !navigator.standalone
    ? NoSleepNative
    : NoSleepVideo;

export default defaultExport;
