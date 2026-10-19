package app.vaka.platform

import io.github.expo.modules.v2.ExpoModule
import io.github.expo.modules.v2.JS
import io.github.expo.modules.v2.JavaScriptThrowable
import io.github.expo.modules.v2.Module
import io.github.expo.modules.v2.Record
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Credentials
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/** An authenticated HTTP proxy. */
@Record
data class ProxyServer(
  val host: String = "",
  val port: Int = 0,
  val username: String = "",
  val password: String = "",
)

@Record
data class ProxiedTextResponse(val status: Int, val body: String)

/**
 * A request that did not get an answer: `ERR_PROXY_AUTH` when the proxy refused the credentials,
 * `ERR_CANCELLED` after `cancel`, `ERR_NETWORK` otherwise.
 */
class ProxiedHttpError(override val code: String, message: String, cause: Throwable?) :
  JavaScriptThrowable(message, cause)

private data class ProxyKey(val host: String, val port: Int, val username: String, val password: String)

/**
 * Reads pages through an authenticated HTTP proxy. React Native's `fetch` has no per-request proxy,
 * so the few requests that need one come here; everything else keeps using `fetch`.
 */
@ExpoModule("ProxiedHttp")
class ProxiedHttpModule : Module() {
  private val baseClient by lazy {
    OkHttpClient.Builder()
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .build()
  }

  // One client per proxy, sharing the base client's connection pool and threads.
  @Volatile private var proxied: Pair<ProxyKey, OkHttpClient>? = null

  private val calls = ConcurrentHashMap<String, Call>()

  private fun client(server: ProxyServer): OkHttpClient {
    val key = ProxyKey(server.host, server.port, server.username, server.password)

    proxied?.let { (cachedKey, client) -> if (cachedKey == key) return client }

    val credentials = Credentials.basic(server.username, server.password)
    val client = baseClient.newBuilder()
      // Left unresolved so OkHttp looks the proxy up on its own threads.
      .proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved(server.host, server.port)))
      .proxyAuthenticator(object : Authenticator {
        override fun authenticate(route: Route?, response: Response): Request? {
          // Credentials that were already refused are not sent again.
          if (response.request.header("Proxy-Authorization") != null) return null

          return response.request.newBuilder().header("Proxy-Authorization", credentials).build()
        }
      })
      .build()

    proxied = key to client

    return client
  }

  /** Reads `url` as text through `server`, as `id`, which `cancel` can stop. */
  @JS
  suspend fun fetchText(
    id: String,
    url: String,
    headers: Map<String, String>,
    server: ProxyServer,
  ): ProxiedTextResponse = suspendCancellableCoroutine { continuation ->
    val request = Request.Builder().url(url).apply { headers.forEach { (name, value) -> header(name, value) } }.build()
    val call = client(server).newCall(request)

    calls[id] = call
    continuation.invokeOnCancellation { call.cancel() }
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        calls.remove(id)

        val code = when {
          call.isCanceled() -> "ERR_CANCELLED"
          // OkHttp's words when the proxy refuses the credentials while opening an HTTPS tunnel.
          e.message?.contains("authenticate with proxy") == true -> "ERR_PROXY_AUTH"
          else -> "ERR_NETWORK"
        }

        continuation.resumeWithException(ProxiedHttpError(code, e.message ?: "Network error", e))
      }

      override fun onResponse(call: Call, response: Response) {
        calls.remove(id)

        response.use {
          try {
            continuation.resume(ProxiedTextResponse(it.code, it.body?.string() ?: ""))
          } catch (e: IOException) {
            val code = if (call.isCanceled()) "ERR_CANCELLED" else "ERR_NETWORK"

            continuation.resumeWithException(ProxiedHttpError(code, e.message ?: "Network error", e))
          }
        }
      }
    })
  }

  /** Stops the request `id`, which then fails as `ERR_CANCELLED`. */
  @JS
  fun cancel(id: String) {
    calls.remove(id)?.cancel()
  }
}
