/* global WebSocket requestAnimationFrame */

'use strict'

const Avc = require('../broadway/Decoder')
const YUVWebGLCanvas = require('../canvas/YUVWebGLCanvas')
const YUVCanvas = require('../canvas/YUVCanvas')
const Size = require('../utils/Size')
const Class = require('uclass')
const Events = require('uclass/events')
const debug = require('debug')
const log = debug('wsavc')

const WSAvcPlayer = new Class({
  Implements: [Events],

  initialize: function (canvas, canvastype) {
    this.canvas = canvas
    this.canvastype = canvastype

    // AVC codec initialization
    this.avc = new Avc()

    // if (false) {
    //   this.avc.configure({
    //     filter: 'original',
    //     filterHorLuma: 'optimized',
    //     filterVerLumaEdge: 'optimized',
    //     getBoundaryStrengthsA: 'optimized'
    //   })
    // }

    // WebSocket variable
    this.ws = null
    this.pktnum = 0
  },

  decode: function (data) {
    let naltype = 'invalid frame'

    if (data.length > 4) {
      if (data[4] === 0x65) {
        naltype = 'I frame'
      } else if (data[4] === 0x41) {
        naltype = 'P frame'
      } else if (data[4] === 0x67) {
        naltype = 'SPS'
      } else if (data[4] === 0x68) {
        naltype = 'PPS'
      }
    }
    log('WSAvcPlayer: Passed ' + naltype + ' to decoder')
    this.avc.decode(data)
  },

  connect: function (url) {
    // Websocket initialization
    if (this.ws !== null) {
      this.ws.close()
      delete this.ws
    }
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'

    this.ws.onopen = () => {
      log('WSAvcPlayer: Connected to ' + url)
      this.emit('connected', url)
    }

    let framesList = []

    this.ws.onmessage = (evt) => {
      if (typeof evt.data === 'string') { return this.cmd(JSON.parse(evt.data)) }

      this.pktnum++
      const frame = new Uint8Array(evt.data)
      // log("[Pkt " + this.pktnum + " (" + evt.data.byteLength + " bytes)]");
      // this.decode(frame);
      framesList.push(frame)
    }

    let running = true
    let previousTimeStamp

    const shiftFrame = function (timestamp) {
      if (!running) { return }

      if (framesList.length > 10) {
        log('WSAvcPlayer: Dropping frames', framesList.length)
        framesList = []
      }

      const frame = framesList.shift()

      if (frame) {
        if (previousTimeStamp !== undefined) {
          const elapsed = timestamp - previousTimeStamp
          const fps = 1 / (elapsed / 1000)
          this.emit('fps', fps.toFixed())
        }
        previousTimeStamp = timestamp

        this.decode(frame)
      }

      requestAnimationFrame(shiftFrame)
    }.bind(this)

    shiftFrame()

    this.ws.onclose = () => {
      running = false
      log('WSAvcPlayer: Connection closed')
      this.emit('close')
    }
  },

  initCanvas: function (width, height) {
    const CanvasFactory = this.canvastype === 'webgl' || this.canvastype === 'YUVWebGLCanvas'
      ? YUVWebGLCanvas
      : YUVCanvas

    const canvas = new CanvasFactory(this.canvas, new Size(width, height))
    this.avc.onPictureDecoded = canvas.decode
    this.emit('canvasReady', width, height)
  },

  cmd: function (cmd) {
    log('WSAvcPlayer: Incoming request', cmd)

    if (cmd.action === 'init') {
      this.initCanvas(cmd.width, cmd.height)
      this.canvas.width = cmd.width
      this.canvas.height = cmd.height
    }

    if (cmd.action === 'busy') {
      this.emit('busy')
    }
  },

  disconnect: function () {
    this.ws.close()
  },

  playStream: function () {
    this.ws.send('REQUESTSTREAM')
    log('WSAvcPlayer: Sent REQUESTSTREAM')
  },

  stopStream: function () {
    this.ws.send('STOPSTREAM')
    log('WSAvcPlayer: Sent STOPSTREAM')
  }
})

module.exports = WSAvcPlayer
module.exports.debug = debug
