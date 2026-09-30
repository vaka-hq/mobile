package expo.modules.proxiedhttp

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
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

/** An authenticated HTTP proxy. */
class ProxyServer : Record {
  @Field val host: String = ""
  @Field val port: Int = 0
  @Field val username: String = ""
  @Field val password: String = ""
}

private data class ProxyKey(val host: String, val port: Int, val username: String, val password: String)

/**
 * Reads pages through an authenticated HTTP proxy. React Native's `fetch` has no per-request proxy,
 * so the few requests that need one come here; everything else keeps using `fetch`.
 */
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

  override fun definition() = ModuleDefinition {
    Name("ProxiedHttp")

    AsyncFunction("fetchText") { id: String, url: String, headers: Map<String, String>, server: ProxyServer, promise: Promise ->
      val request = Request.Builder().url(url).apply { headers.forEach { (name, value) -> header(name, value) } }.build()
      val call = client(server).newCall(request)

      calls[id] = call
      call.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
          calls.remove(id)

          val code = when {
            call.isCanceled() -> "ERR_CANCELLED"
            // OkHttp's words when the proxy refuses the credentials while opening an HTTPS tunnel.
            e.message?.contains("authenticate with proxy") == true -> "ERR_PROXY_AUTH"
            else -> "ERR_NETWORK"
          }

          promise.reject(code, e.message ?: "Network error", e)
        }

        override fun onResponse(call: Call, response: Response) {
          calls.remove(id)

          response.use {
            try {
              promise.resolve(mapOf("status" to it.code, "body" to (it.body?.string() ?: "")))
            } catch (e: IOException) {
              promise.reject(if (call.isCanceled()) "ERR_CANCELLED" else "ERR_NETWORK", e.message ?: "Network error", e)
            }
          }
        }
      })
    }

    Function("cancel") { id: String ->
      calls.remove(id)?.cancel()
    }
  }
}
