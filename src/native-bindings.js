const path = require('path');

const exokitNode = (() => {
  const oldCwd = process.cwd();
  const nodeModulesDir = path.resolve(path.dirname(require.resolve('native-graphics-deps')), '..');
  process.chdir(nodeModulesDir);
  const exokitNode = require(path.join(__dirname, '..', 'build', 'Release', 'exokit.node'));
  process.chdir(oldCwd);
  return exokitNode;
})();
const vmOne = require('vm-one');
const {nativeWindow} = exokitNode;
const webGlToOpenGl = require('webgl-to-opengl');
const GlobalContext = require('./GlobalContext');

const bindings = {};
for (const k in exokitNode) {
  bindings[k] = exokitNode[k];
}
bindings.nativeVm = vmOne;
const _decorateGlIntercepts = gl => {
  gl.createShader = (createShader => function(type) {
    const result = createShader.call(this, type);
    result.type = type;
    return result;
  })(gl.createShader);
  gl.shaderSource = (shaderSource => function(shader, source) {
    if (shader.type === gl.VERTEX_SHADER) {
      source = webGlToOpenGl.vertex(source);
    } else if (shader.type === gl.FRAGMENT_SHADER) {
      source = webGlToOpenGl.fragment(source);
    }
    return shaderSource.call(this, shader, source);
  })(gl.shaderSource);
  gl.getActiveAttrib = (getActiveAttrib => function(program, index) {
    const result = getActiveAttrib.call(this, program, index);
    if (result) {
      result.name = webGlToOpenGl.unmapName(result.name);
    }
    return result;
  })(gl.getActiveAttrib);
  gl.getActiveUniform = (getActiveUniform => function(program, index) {
    const result = getActiveUniform.call(this, program, index);
    if (result) {
      result.name = webGlToOpenGl.unmapName(result.name);
    }
    return result;
  })(gl.getActiveUniform);
  gl.getAttribLocation = (getAttribLocation => function(program, path) {
    path = webGlToOpenGl.mapName(path);
    return getAttribLocation.call(this, program, path);
  })(gl.getAttribLocation);
  gl.getUniformLocation = (getUniformLocation => function(program, path) {
    path = webGlToOpenGl.mapName(path);
    return getUniformLocation.call(this, program, path);
  })(gl.getUniformLocation);
  gl.setCompatibleXRDevice = () => Promise.resolve();
};
let contextId = 0;
const _onGl3DConstruct = (gl, canvas) => {
  const canvasWidth = canvas.width || innerWidth;
  const canvasHeight = canvas.height || innerHeight;

  gl.canvas = canvas;

  const document = canvas.ownerDocument;
  const window = document.defaultView;

  const windowSpec = (() => {
    if (!args.headless) {
      try {
        const visible = document.documentElement.contains(canvas);
        const {hidden} = document;
        const windowHandle = Array.from(GlobalContext.xrState.windowHandle);
        return nativeWindow.create3d(canvasWidth, canvasHeight, visible && !hidden, windowHandle, gl);
      } catch (err) {
        console.warn(err.message);
        return null;
      }
    } else {
      return null;
    }
  })();

  if (windowSpec) {
    const [windowHandle, sharedFramebuffer, sharedColorTexture, sharedDepthStencilTexture, sharedMsFramebuffer, sharedMsColorTexture, sharedMsDepthStencilTexture, vao] = windowSpec;

    gl.setWindowHandle(windowHandle);
    gl.setDefaultVao(vao);
    nativeWindow.setEventHandler(windowHandle, (type, data) => {
      switch (type) {
        case 'focus': {
          const {focused} = data;
          if (!focused && window.top.document.pointerLockElement) {
            window.top.document.exitPointerLock();
          }
          break;
        }
        case 'framebufferResize': {
          const {width, height} = data;
          // innerWidth = width;
          // innerHeight = height;

          window.innerWidth = width / window.devicePixelRatio;
          window.innerHeight = height / window.devicePixelRatio;
          window.dispatchEvent(new window.Event('resize'));
          break;
        }
        case 'keydown': {
          let handled = false;
          if (data.keyCode === 27) { // ESC
            if (window.top.document.pointerLockElement) {
              window.top.document.exitPointerLock();
              handled = true;
            }
            if (window.top.document.fullscreenElement) {
              window.top.document.exitFullscreen();
              handled = true;
            }
          }
          if (data.keyCode === 122) { // F11
            if (window.top.document.fullscreenElement) {
              window.top.document.exitFullscreen();
              handled = true;
            } else {
              window.top.document.requestFullscreen();
              handled = true;
            }
          }

          if (!handled) {
            canvas.dispatchEvent(new window.KeyboardEvent(type, data));
          }
          break;
        }
        case 'keyup':
        case 'keypress': {
          canvas.dispatchEvent(new window.KeyboardEvent(type, data));
          break;
        }
        case 'mousedown':
        case 'mouseup':
        case 'click': {
          canvas.dispatchEvent(new window.MouseEvent(type, data));
          break;
        }
        case 'wheel': {
          canvas.dispatchEvent(new window.WheelEvent(type, data));
          break;
        }
        case 'mousemove': {
          canvas.dispatchEvent(new window.MouseEvent(type, data));
          break;
        }
        case 'drop': {
          const _readFiles = paths => {
            const result = [];

            return Promise.all(paths.map(p =>
              new Promise((accept, reject) => {
                fs.lstat(p, (err, stats) => {
                  if (!err) {
                    if (stats.isFile()) {
                      fs.readFile(p, (err, data) => {
                        if (!err) {
                          const file = new window.Blob([data]);
                          file.name = path.basename(p);
                          file.path = p;
                          result.push(file);

                          accept();
                        } else {
                          reject(err);
                        }
                      });
                    } else if (stats.isDirectory()) {
                      fs.readdir(p, (err, fileNames) => {
                        if (!err) {
                          _readFiles(fileNames.map(fileName => path.join(p, fileName)))
                            .then(files => {
                              result.push.apply(result, files);

                              accept();
                            })
                            .catch(err => {
                              reject(err);
                            });
                        } else {
                          reject(err);
                        }
                      });
                    } else {
                      accept();
                    }
                  } else {
                    reject(err);
                  }
                });
              })
            ))
              .then(() => result);
          };

          _readFiles(data.paths)
            .then(files => {
              const dataTransfer = new window.DataTransfer({
                files,
              });
              const e = new window.DragEvent('drop');
              e.dataTransfer = dataTransfer;
              canvas.dispatchEvent(e);
            })
            .catch(err => {
              console.warn(err.stack);
            });
          break;
        }
        case 'quit': {
          context.destroy();
          break;
        }
      }
    });

    const nativeWindowSize = nativeWindow.getFramebufferSize(windowHandle);
    const nativeWindowHeight = nativeWindowSize.height;
    const nativeWindowWidth = nativeWindowSize.width;

    // Calculate devicePixelRatio.
    window.devicePixelRatio = nativeWindowWidth / canvasWidth;

    // Tell DOM how large the window is.
    // window.innerHeight = nativeWindowHeight / window.devicePixelRatio;
    // window.innerWidth = nativeWindowWidth / window.devicePixelRatio;

    const title = `Exokit ${version}`;
    nativeWindow.setWindowTitle(windowHandle, title);

    let framebuffer;

    const {hidden} = document;
    if (hidden) {
      const [fbo, tex, depthTex, msFbo, msTex, msDepthTex] = nativeWindow.createRenderTarget(gl, canvasWidth, canvasHeight, sharedColorTexture, sharedDepthStencilTexture, sharedMsColorTexture, sharedMsDepthStencilTexture);

      gl.setDefaultFramebuffer(msFbo);

      gl.resize = (width, height) => {
        nativeWindow.setCurrentWindowContext(windowHandle);
        nativeWindow.resizeRenderTarget(gl, width, height, fbo, tex, depthTex, msFbo, msTex, msDepthTex);
      };

      framebuffer = {
        msFbo,
        msTex,
        msDepthTex,
        fbo,
        tex,
        depthTex,
      };
    } else {
      gl.resize = (width, height) => {
        nativeWindow.setCurrentWindowContext(windowHandle);
        nativeWindow.resizeRenderTarget(gl, width, height, sharedFramebuffer, sharedColorTexture, sharedDepthStencilTexture, sharedMsFramebuffer, sharedMsColorTexture, sharedMsDepthStencilTexture);
      };
    }

    const ondomchange = () => {
      process.nextTick(() => { // show/hide synchronously emits events
        if (!hidden) {
          const domVisible = canvas.ownerDocument.documentElement.contains(canvas);
          const windowVisible = nativeWindow.isVisible(windowHandle);
          if (domVisible) {
            if (!windowVisible) {
              nativeWindow.show(windowHandle);
            }
          } else {
            if (windowVisible) {
              nativeWindow.hide(windowHandle);
            }
          }
        }
      });
    };
    canvas.ownerDocument.on('domchange', ondomchange);

    gl.destroy = (destroy => function() {
      destroy.call(this);

      nativeWindow.setCurrentWindowContext(windowHandle);

      if (gl === vrPresentState.glContext) {
        nativeVr.VR_Shutdown();

        vrPresentState.glContext = null;
        vrPresentState.system = null;
        vrPresentState.compositor = null;
      }
      if (gl === mlPresentState.mlGlContext) {
        mlPresentState.mlGlContext = null;
      }

      nativeWindow.destroy(windowHandle);
      canvas._context = null;

      /* if (hidden) {
        document._emit('framebuffer', null);
      } */
      canvas.ownerDocument.removeListener('domchange', ondomchange);

      window.postInternalMessage({
        type: 'postRequestAsync',
        method: 'context.destroy',
        args: {
          id,
        },
      });
      GlobalContext.contexts.splice(GlobalContext.contexts.indexOf(gl), 1);
    })(gl.destroy);
  } else {
    gl.destroy();
  }

  const id = ++contextId;
  gl.id = id;
  window.postInternalMessage({
    type: 'postRequestAsync',
    method: 'context.create',
    args: {
      id,
      framebuffer,
    },
  });
  GlobalContext.contexts.push(gl);
};
bindings.nativeGl = (nativeGl => {
  function WebGLRenderingContext(canvas) {
    const gl = new nativeGl();
    _decorateGlIntercepts(gl);
    _onGl3DConstruct(gl, canvas);
    return gl;
  }
  for (const k in nativeGl) {
    WebGLRenderingContext[k] = nativeGl[k];
  }
  return WebGLRenderingContext;
})(bindings.nativeGl);
bindings.nativeGl2 = (nativeGl2 => {
  function WebGL2RenderingContext(canvas) {
    const gl = new nativeGl2();
    _decorateGlIntercepts(gl);
    _onGl3DConstruct(gl, canvas);
    return gl;
  }
  for (const k in nativeGl2) {
    WebGL2RenderingContext[k] = nativeGl2[k];
  }
  return WebGL2RenderingContext;
})(bindings.nativeGl2);

const _onGl2DConstruct = (ctx, canvas) => {
  const canvasWidth = canvas.width || innerWidth;
  const canvasHeight = canvas.height || innerHeight;

  ctx.canvas = canvas;

  const window = canvas.ownerDocument.defaultView;

  const windowSpec = (() => {
    if (!window[symbols.optionsSymbol].args.headless) {
      try {
        const windowHandle = Array.from(GlobalContext.xrState.windowHandle);
        return nativeWindow.create2d(canvasWidth, canvasHeight, windowHandle);
      } catch (err) {
        console.warn(err.message);
        return null;
      }
    } else {
      return null;
    }
  })();

  if (windowSpec) {
    const [windowHandle, tex] = windowSpec;

    ctx.setWindowHandle(windowHandle);
    ctx.setTexture(tex, canvasWidth, canvasHeight);
    
    ctx.destroy = (destroy => function() {
      destroy.call(this);
      
      nativeWindow.destroy(windowHandle);
      canvas._context = null;
      
      window.postInternalMessage({
        type: 'postRequestAsync',
        method: 'context.destroy',
        args: {
          id,
        },
      });
      GlobalContext.contexts.splice(GlobalContext.contexts.indexOf(ctx), 1);
    })(ctx.destroy);
  } else {
    ctx.destroy();
  }

  const id = ++contextId;
  ctx.id = id;
  window.postInternalMessage({
    type: 'postRequestAsync',
    method: 'context.create',
    args: {
      id,
    },
  });
  GlobalContext.contexts.push(ctx);
};
bindings.nativeCanvasRenderingContext2D = (nativeCanvasRenderingContext2D => {
  function CanvasRenderingContext2D(canvas) {
    const ctx = new nativeCanvasRenderingContext2D();
    _onGl2DConstruct(ctx, canvas);
    return ctx;
  }
  for (const k in nativeCanvasRenderingContext2D) {
    CanvasRenderingContext2D[k] = nativeCanvasRenderingContext2D[k];
  }
  return CanvasRenderingContext2D;
})(bindings.nativeCanvasRenderingContext2D);
GlobalContext.CanvasRenderingContext2D = bindings.nativeCanvasRenderingContext2D;
GlobalContext.WebGLRenderingContext = bindings.nativeGl;
GlobalContext.WebGL2RenderingContext = bindings.nativeGl2;

bindings.nativeAudio.AudioContext = (OldAudioContext => class AudioContext extends OldAudioContext {
  decodeAudioData(arrayBuffer, successCallback, errorCallback) {
    return new Promise((resolve, reject) => {
      try {
        let audioBuffer = this._decodeAudioDataSync(arrayBuffer);
        if (successCallback) {
          process.nextTick(() => {
            try {
              successCallback(audioBuffer);
            } catch(err) {
              console.warn(err);
            }
          });
        }
        resolve(audioBuffer);
      } catch(err) {
        console.warn(err);
        if (errorCallback) {
          process.nextTick(() => {
            try {
              errorCallback(err);
            } catch(err) {
              console.warn(err);
            }
          });
        }
        reject(err);
      }
    });
  }
})(bindings.nativeAudio.AudioContext);

bindings.nativeAudio.PannerNode.setPath(path.join(require.resolve('native-audio-deps').slice(0, -'index.js'.length), 'assets', 'hrtf'));

if (bindings.nativeVr) {
	bindings.nativeVr.EVRInitError = {
	  None: 0,
	  Unknown: 1,

	  Init_InstallationNotFound: 100,
	  Init_InstallationCorrupt: 101,
	  Init_VRClientDLLNotFound: 102,
	  Init_FileNotFound: 103,
	  Init_FactoryNotFound: 104,
	  Init_InterfaceNotFound: 105,
	  Init_InvalidInterface: 106,
	  Init_UserConfigDirectoryInvalid: 107,
	  Init_HmdNotFound: 108,
	  Init_NotInitialized: 109,
	  Init_PathRegistryNotFound: 110,
	  Init_NoConfigPath: 111,
	  Init_NoLogPath: 112,
	  Init_PathRegistryNotWritable: 113,
	  Init_AppInfoInitFailed: 114,
	  Init_Retry: 115,
	  Init_InitCanceledByUser: 116,
	  Init_AnotherAppLaunching: 117,
	  Init_SettingsInitFailed: 118,
	  Init_ShuttingDown: 119,
	  Init_TooManyObjects: 120,
	  Init_NoServerForBackgroundApp: 121,
	  Init_NotSupportedWithCompositor: 122,
	  Init_NotAvailableToUtilityApps: 123,
	  Init_Internal: 124,
	  Init_HmdDriverIdIsNone: 125,
	  Init_HmdNotFoundPresenceFailed: 126,
	  Init_VRMonitorNotFound: 127,
	  Init_VRMonitorStartupFailed: 128,
	  Init_LowPowerWatchdogNotSupported: 129,
	  Init_InvalidApplicationType: 130,
	  Init_NotAvailableToWatchdogApps: 131,
	  Init_WatchdogDisabledInSettings: 132,
	  Init_VRDashboardNotFound: 133,
	  Init_VRDashboardStartupFailed: 134,

	  Driver_Failed: 200,
	  Driver_Unknown: 201,
	  Driver_HmdUnknown: 202,
	  Driver_NotLoaded: 203,
	  Driver_RuntimeOutOfDate: 204,
	  Driver_HmdInUse: 205,
	  Driver_NotCalibrated: 206,
	  Driver_CalibrationInvalid: 207,
	  Driver_HmdDisplayNotFound: 208,
	  Driver_TrackedDeviceInterfaceUnknown: 209,
	  Driver_HmdDriverIdOutOfBounds: 211,
	  Driver_HmdDisplayMirrored: 212,

	  IPC_ServerInitFailed: 300,
	  IPC_ConnectFailed: 301,
	  IPC_SharedStateInitFailed: 302,
	  IPC_CompositorInitFailed: 303,
	  IPC_MutexInitFailed: 304,
	  IPC_Failed: 305,
	  IPC_CompositorConnectFailed: 306,
	  IPC_CompositorInvalidConnectResponse: 307,
	  IPC_ConnectFailedAfterMultipleAttempts: 308,

	  Compositor_Failed: 400,
	  Compositor_D3D11HardwareRequired: 401,
	  Compositor_FirmwareRequiresUpdate: 402,
	  Compositor_OverlayInitFailed: 403,
	  Compositor_ScreenshotsInitFailed: 404,

	  VendorSpecific_UnableToConnectToOculusRuntime: 1000,

	  VendorSpecific_HmdFound_CantOpenDevice: 1101,
	  VendorSpecific_HmdFound_UnableToRequestConfigStart: 1102,
	  VendorSpecific_HmdFound_NoStoredConfig: 1103,
	  VendorSpecific_HmdFound_ConfigTooBig: 1104,
	  VendorSpecific_HmdFound_ConfigTooSmall: 1105,
	  VendorSpecific_HmdFound_UnableToInitZLib: 1106,
	  VendorSpecific_HmdFound_CantReadFirmwareVersion: 1107,
	  VendorSpecific_HmdFound_UnableToSendUserDataStart: 1108,
	  VendorSpecific_HmdFound_UnableToGetUserDataStart: 1109,
	  VendorSpecific_HmdFound_UnableToGetUserDataNext: 1110,
	  VendorSpecific_HmdFound_UserDataAddressRange: 1111,
	  VendorSpecific_HmdFound_UserDataError: 1112,
	  VendorSpecific_HmdFound_ConfigFailedSanityCheck: 1113,

	  Steam_SteamInstallationNotFound: 2000,
	};

	bindings.nativeVr.EVRApplicationType = {
	  Other: 0,
	  Scene: 1,
	  Overlay: 2,
	  Background: 3,
	  Utility: 4,
	  VRMonitor: 5,
	  SteamWatchdog: 6,
	  Bootstrapper: 7,
	};

	bindings.nativeVr.EVREye = {
	  Left: 0,
	  Right: 1,
	};

	bindings.nativeVr.ETrackingUniverseOrigin = {
	  Seated: 0,
	  Standing: 1,
	  RawAndUncalibrated: 2,
	};

	bindings.nativeVr.ETrackingResult = {
	  Uninitialized: 1,
	  Calibrating_InProgress: 100,
	  Calibrating_OutOfRange: 101,
	  Running_OK: 200,
	  Running_OutOfRange: 201,
	};

	bindings.nativeVr.ETrackedDeviceClass = {
	  Invalid: 0,
	  HMD: 1,
	  Controller: 2,
	  GenericTracker: 3,
	  TrackingReference: 4,
	  DisplayRedirect: 5,
	};
}

GlobalContext.nativeVr = bindings.nativeVr;
GlobalContext.nativeMl = bindings.nativeMl;
GlobalContext.nativeBrowser = bindings.nativeBrowser;

if (nativeVr) {
  const cleanups = [];
  nativeVr.requestPresent = async function(layers) {
    const layer = layers.find(layer => layer && layer.source && layer.source.tagName === 'CANVAS');
    if (layer) {
      const canvas = layer.source;

      const presentSpec = await window.postInternalMessage({
        type: 'postRequestAsync',
        method: 'requestPresentVr',
      });

      if (!presentSpec.wasPresenting) {
        let context = canvas._context;
        if (!(context && context.constructor && context.constructor.name === 'WebGLRenderingContext')) {
          context = canvas.getContext('webgl');
        }
        const window = canvas.ownerDocument.defaultView;

        const {width, height} = presentSpec;
        
        const windowHandle = context.getWindowHandle();
        nativeWindow.setCurrentWindowContext(windowHandle);

        const [fbo, tex, depthTex, msFbo, msTex, msDepthTex] = nativeWindow.createRenderTarget(context, width, height, 0, 0, 0, 0);

        // vrPresentState.lmContext = lmContext;

        const framebuffer = {
          width,
          height,
          msFbo,
          msTex,
          msDepthTex,
          fbo,
          tex,
          depthTex,
        };
        await window.postInternalMessage({
          type: 'postRequestAsync',
          method: 'vr.bind',
          id: context.id,
          framebuffer,
        });
        
        context.setDefaultFramebuffer(msFbo);

        const _attribute = (name, value) => {
          if (name === 'width' || name === 'height') {
            nativeWindow.setCurrentWindowContext(windowHandle);

            nativeWindow.resizeRenderTarget(context, canvas.width, canvas.height, fbo, tex, depthTex, msFbo, msTex, msDepthTex);
          }
        };
        canvas.on('attribute', _attribute);
        cleanups.push(() => {
          canvas.removeListener('attribute', _attribute);
        });

        return framebuffer;
      } else if (canvas.ownerDocument.framebuffer) {
        const {width, height} = canvas;
        const {msFbo, msTex, msDepthTex, fbo, tex, depthTex} = canvas.ownerDocument.framebuffer;
        return {
          width,
          height,
          msFbo,
          msTex,
          msDepthTex,
          fbo,
          tex,
          depthTex,
        };
      } else {
        return presentSpec;
        /* const {msFbo, msTex, msDepthTex, fbo, tex, depthTex} = vrPresentState;
        return {
          width: xrState.renderWidth[0] * 2,
          height: xrState.renderHeight[0],
          msFbo,
          msTex,
          msDepthTex,
          fbo,
          tex,
          depthTex,
        }; */
      }
    } else {
      throw new Error('no HTMLCanvasElement source provided');
    }
  };
  nativeVr.exitPresent = await function() {
    const presentSpec = await window.postRequest({
      method: 'exitPresentVr',
    });
      
    if (presentSpec) {
      nativeWindow.destroyRenderTarget(presentSpec.msFbo, presentSpec.msTex, presentSpec.msDepthStencilTex);
      nativeWindow.destroyRenderTarget(presentSpec.fbo, presentSpec.tex, presentSpec.msDepthTex);

      const context = vrPresentState.glContext; // XXX get the real context
      nativeWindow.setCurrentWindowContext(context.getWindowHandle());
      context.setDefaultFramebuffer(0);

      for (let i = 0; i < cleanups.length; i++) {
        cleanups[i]();
      }
      cleanups.length = 0;
    }
  };
}

if (nativeMl) {
  let canvas = null;
  const cleanups = [];
  nativeMl.requestPresent = async function(layers) {
    const layer = layers.find(layer => layer && layer.source && layer.source.tagName === 'CANVAS');
    if (layer) {
      canvas = layer.source;
      
      const presentSpec = await window.postInternalMessage({
        type: 'postRequestAsync',
        method: 'requestPresentMl',
      });

      if (!presentSpec.wasPresenting) {
        let context = canvas._context;
        if (!(context && context.constructor && context.constructor.name === 'WebGLRenderingContext')) {
          context = canvas.getContext('webgl');
        }
        
        const {width, height} = presentSpec;

        const windowHandle = context.getWindowHandle();
        nativeWindow.setCurrentWindowContext(windowHandle);

        const [fbo, tex, depthTex, msFbo, msTex, msDepthTex] = nativeWindow.createRenderTarget(context, width, height, 0, 0, 0, 0);

        const framebuffer = {
          width,
          height,
          msFbo,
          msTex,
          msDepthTex,
          fbo,
          tex,
          depthTex,
        };
        await window.postInternalMessage({
          type: 'postRequestAsync',
          method: 'ml.bind',
          id: context.id,
          framebuffer,
        });

        const _attribute = (name, value) => {
          if (name === 'width' || name === 'height') {
            nativeWindow.setCurrentWindowContext(windowHandle);

            nativeWindow.resizeRenderTarget(context, canvas.width, canvas.height, fbo, tex, depthTex, msFbo, msTex, msDepthTex);
          }
        };
        canvas.on('attribute', _attribute);
        cleanups.push(() => {
          canvas.removeListener('attribute', _attribute);
        });

        context.setDefaultFramebuffer(msFbo);

        return framebuffer;
      } else if (canvas.ownerDocument.framebuffer) {
        const {width, height} = canvas;
        const {msFbo, msTex, msDepthTex, fbo, tex, depthTex} = canvas.ownerDocument.framebuffer;
        
        return {
          width,
          height,
          msFbo,
          msTex,
          msDepthTex,
          fbo,
          tex,
          depthTex,
        };
      } else {
        return presentSpec;
        /* return {
          width: xrState.renderWidth[0] * 2,
          height: xrState.renderHeight[0],
          msFbo: mlPresentState.mlMsFbo,
          msTex: mlPresentState.mlMsTex,
          msDepthTex: mlPresentState.mlMsDepthTex,
          fbo: mlPresentState.mlFbo,
          tex: mlPresentState.mlTex,
          depthTex: mlPresentState.mlDepthTex,
        }; */
      }
    } else {
      throw new Error('no HTMLCanvasElement source provided');
    }
  };
  nativeMl.exitPresent = async function() {
    const presentSpec = await window.postRequest({
      method: 'exitPresentMl',
    });

    if (presentSpec) {
      nativeWindow.destroyRenderTarget(presentSpec.mlMsFbo, presentSpec.mlMsTex, presentSpec.mlMsDepthTex);
      nativeWindow.destroyRenderTarget(presentSpec.mlFbo, presentSpec.mlTex, presentSpec.mlDepthTex);

      nativeWindow.setCurrentWindowContext(mlPresentState.mlGlContext.getWindowHandle()); // XXX get the real context
      mlPresentState.mlGlContext.setDefaultFramebuffer(0);

      canvas = null;
      for (let i = 0; i < cleanups.length; i++) {
        cleanups[i]();
      }
      cleanups.length = 0;
    }
  };

  const _mlLifecycleEvent = e => {
    console.log('got ml lifecycle event', e);

    switch (e) {
      case 'newInitArg': {
        break;
      }
      case 'stop':
      case 'pause': {
        if (mlPresentState.mlContext) {
          mlPresentState.mlContext.Exit();
        }
        nativeMl.DeinitLifecycle();
        process.exit();
        break;
      }
      case 'resume': {
        break;
      }
      case 'unloadResources': {
        break;
      }
      default: {
        console.warn('invalid ml lifecycle event', e);
        break;
      }
    }
  };
  const _mlKeyboardEvent = e => { // XXX ensure these are called in the window's event loop
    // console.log('got ml keyboard event', e);

    const window = canvas.ownerDocument.defaultView;

    switch (e.type) {
      case 'keydown': {
        let handled = false;
        if (e.keyCode === 27) { // ESC
          if (window.top.document.pointerLockElement) {
            window.top.document.exitPointerLock();
            handled = true;
          }
          if (window.top.document.fullscreenElement) {
            window.top.document.exitFullscreen();
            handled = true;
          }
        }
        if (e.keyCode === 122) { // F11
          if (window.top.document.fullscreenElement) {
            window.top.document.exitFullscreen();
            handled = true;
          } else {
            window.top.document.requestFullscreen();
            handled = true;
          }
        }

        if (!handled) {
          canvas.dispatchEvent(new window.KeyboardEvent(e.type, e));
        }
        break;
      }
      case 'keyup':
      case 'keypress': {
        canvas.dispatchEvent(new window.KeyboardEvent(e.type, e));
        break;
      }
      default:
        break;
    }
  };
  if (!nativeMl.IsSimulated()) {
    nativeMl.InitLifecycle(); // XXX do this only in the top level thread
    nativeMl.SetEventHandlers(_mlLifecycleEvent, _mlKeyboardEvent);
  } else {
    // try to connect to MLSDK
    const MLSDK_PORT = 17955;
    const s = net.connect(MLSDK_PORT, '127.0.0.1', () => {
      s.destroy();

      nativeMl.InitLifecycle(_mlLifecycleEvent, _mlKeyboardEvent);
    });
    s.on('error', () => {});
  }
}

module.exports = bindings;
