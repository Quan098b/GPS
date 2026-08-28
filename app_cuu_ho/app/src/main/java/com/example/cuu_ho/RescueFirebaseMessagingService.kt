package com.example.cuu_ho

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Nhan canh bao SOS qua FCM (topic "rescue_team").
 *
 * onMessageReceived() chi duoc he thong goi khi app dang FOREGROUND (vi
 * payload backend gui kem ca "notification" lan "data" - xem
 * web/server/services/firebaseSosService.js). Khi app o background/da bi
 * dong, Android tu hien thi notification he thong tu truong "notification"
 * cua payload, va khi nguoi dung nham vao no, toan bo "data" payload duoc
 * dinh kem san lam extras cho Intent mo MainActivity - xu ly o
 * MainActivity.handleNotificationIntent().
 */
class RescueFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // Demo dung topic "rescue_team" chung cho ca doi, khong can dang ky
        // token rieng ve backend.
        Log.d(TAG, "FCM token moi: $token")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        Log.d(TAG, "Nhan FCM data=${message.data} notification=${message.notification?.title}")

        val data = message.data
        val title = message.notification?.title ?: getString(R.string.notification_title_new_sos)
        val body = message.notification?.body
            ?: "${data["device_id"] ?: ""}: ${data["message"] ?: ""}"

        showNotification(this, title, body, data)
    }

    companion object {
        private const val TAG = "RescueFCM"

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val channelId = context.getString(R.string.notification_channel_id)
            val manager = context.getSystemService<NotificationManager>() ?: return
            if (manager.getNotificationChannel(channelId) != null) return
            val channel = NotificationChannel(
                channelId,
                context.getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = context.getString(R.string.notification_channel_description)
                enableVibration(true)
                enableLights(true)
            }
            manager.createNotificationChannel(channel)
        }

        fun showNotification(context: Context, title: String, body: String, data: Map<String, String>) {
            ensureChannel(context)

            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(MainActivity.EXTRA_DEVICE_ID, data["device_id"])
                putExtra(MainActivity.EXTRA_LATITUDE, data["latitude"])
                putExtra(MainActivity.EXTRA_LONGITUDE, data["longitude"])
                putExtra(MainActivity.EXTRA_MESSAGE, data["message"])
                putExtra(MainActivity.EXTRA_TIMESTAMP, data["timestamp"])
            }
            val requestCode = data["device_id"]?.hashCode() ?: 0
            val pendingIntent = PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val channelId = context.getString(R.string.notification_channel_id)
            val notification = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build()

            if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                // Nguoi dung tu choi quyen thong bao - khong crash, chi bo qua hien thi.
                return
            }
            NotificationManagerCompat.from(context).notify(requestCode, notification)
        }
    }
}
