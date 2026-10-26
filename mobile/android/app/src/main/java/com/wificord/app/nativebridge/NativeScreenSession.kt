package com.wificord.app.nativebridge

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import org.webrtc.*
import java.util.UUID
import android.os.Handler
import android.os.Looper

// A track nativa chega à WebView por uma conexão WebRTC local, sem PNGs,
// polling ou frames base64. A chamada continua usando seus transceptores.
class NativeScreenSession(private val context: Context, private val grant: Intent,
    private val width: Int, private val height: Int,
    private val offered: (String, String) -> Unit, private val failed: (String) -> Unit,
    private val stopped: (String) -> Unit) {
    companion object { private var initialized = false }
    val id = UUID.randomUUID().toString()
    @Volatile private var closed = false
    @Volatile private var offerSent = false
    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var source: VideoSource? = null
    private var texture: SurfaceTextureHelper? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var track: VideoTrack? = null
    private var peer: PeerConnection? = null
    private val handler = Handler(Looper.getMainLooper())
    private val offerDeadline = Runnable { if (!offerSent && !closed) error("A preparação da captura expirou") }
    private fun error(message: String) { failed(message); stop() }
    @Synchronized private fun publishOffer() {
        val sdp = peer?.localDescription?.description ?: return
        if (!offerSent && !closed) { offerSent = true; handler.removeCallbacks(offerDeadline); offered(id, sdp) }
    }
    fun start() {
        if (closed) return
        handler.postDelayed(offerDeadline, 15000)
        try {
            synchronized(NativeScreenSession::class.java) {
                if (!initialized) {
                    PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
                    initialized = true
                }
            }
            egl = EglBase.create()
            factory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl!!.eglBaseContext, true, false))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl!!.eglBaseContext)).createPeerConnectionFactory()
            source = factory!!.createVideoSource(true)
            texture = SurfaceTextureHelper.create("WifiCordScreen", egl!!.eglBaseContext)
            capturer = ScreenCapturerAndroid(grant, object : MediaProjection.Callback() {
                override fun onStop() { stop() }
            })
            capturer!!.initialize(texture, context, source!!.capturerObserver)
            capturer!!.startCapture(width, height, 15)
            track = factory!!.createVideoTrack("wificord-screen", source)
            val config = PeerConnection.RTCConfiguration(emptyList())
            config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            peer = factory!!.createPeerConnection(config, object : PeerConnection.Observer {
                override fun onSignalingChange(state: PeerConnection.SignalingState) {}
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) { if (state == PeerConnection.IceConnectionState.FAILED) error("Falha na ponte local de vídeo") }
                override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) { if (state == PeerConnection.IceGatheringState.COMPLETE) publishOffer() }
                override fun onIceCandidate(candidate: IceCandidate) {}
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
                override fun onAddStream(stream: MediaStream) {}
                override fun onRemoveStream(stream: MediaStream) {}
                override fun onDataChannel(channel: DataChannel) {}
                override fun onRenegotiationNeeded() {}
                override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {}
            }) ?: throw IllegalStateException("PeerConnection indisponível")
            peer!!.addTrack(track, listOf("wificord-native-screen"))
            peer!!.createOffer(object : SdpObserverAdapter() {
                override fun onCreateSuccess(sdp: SessionDescription) {
                    peer?.setLocalDescription(object : SdpObserverAdapter() {
                        override fun onSetSuccess() { if (peer?.iceGatheringState() == PeerConnection.IceGatheringState.COMPLETE) publishOffer() }
                        override fun onSetFailure(message: String) { error(message) }
                    }, sdp)
                }
                override fun onCreateFailure(message: String) { error(message) }
            }, MediaConstraints())
        } catch (e: Exception) { error(e.message ?: "Falha ao capturar tela") }
    }
    fun answer(sdp: String, done: () -> Unit, rejected: (String) -> Unit) {
        if (closed || peer == null) { rejected("Captura encerrada"); return }
        peer!!.setRemoteDescription(object : SdpObserverAdapter() {
            override fun onSetSuccess() { done() }
            override fun onSetFailure(message: String) { rejected(message); stop() }
        }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
    }
    fun resize(width: Int, height: Int) {
        if (closed) return
        try { capturer?.changeCaptureFormat(width, height, 15) } catch (e: Exception) { error(e.message ?: "Falha ao adaptar captura") }
    }
    fun stop() {
        if (Looper.myLooper() != Looper.getMainLooper()) { Handler(Looper.getMainLooper()).post { stop() }; return }
        if (closed) return
        closed = true
        handler.removeCallbacks(offerDeadline)
        try { capturer?.stopCapture() } catch (_: Exception) {}
        capturer?.dispose(); capturer = null
        peer?.close(); peer?.dispose(); peer = null
        track?.dispose(); track = null
        source?.dispose(); source = null
        texture?.dispose(); texture = null
        factory?.dispose(); factory = null
        egl?.release(); egl = null
        stopped(id)
    }
}
open class SdpObserverAdapter : SdpObserver {
    override fun onCreateSuccess(sdp: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(message: String) {}
    override fun onSetFailure(message: String) {}
}
