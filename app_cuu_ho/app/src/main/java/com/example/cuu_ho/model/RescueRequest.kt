package com.example.cuu_ho.model

import android.content.Context
import com.example.cuu_ho.R
import com.google.firebase.database.DataSnapshot

/**
 * Mot yeu cau cuu ho doc tu Firebase Realtime Database tai /sos/{deviceId}.
 * Firebase status la chuoi tho ("waiting", "confirmed", ...) ghi boi ESP32
 * hoac boi backend sau khi xu ly action - xem [RescueStatus] de map sang
 * nhan tieng Viet hien thi cho doi cuu ho.
 */
data class RescueRequest(
    val deviceId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float?,
    val message: String?,
    val status: String,
    val timestamp: Long?,
    val confirmedBy: String?,
    val reason: String?
) {
    companion object {
        fun fromSnapshot(snapshot: DataSnapshot): RescueRequest? {
            val deviceId = snapshot.key ?: return null
            val latitude = snapshot.child("latitude").value?.toString()?.toDoubleOrNull()
            val longitude = snapshot.child("longitude").value?.toString()?.toDoubleOrNull()
            if (latitude == null || longitude == null) return null

            return RescueRequest(
                deviceId = deviceId,
                latitude = latitude,
                longitude = longitude,
                accuracy = snapshot.child("accuracy").value?.toString()?.toFloatOrNull(),
                message = snapshot.child("message").value?.toString()?.takeIf { it.isNotBlank() },
                status = snapshot.child("status").value?.toString()?.lowercase() ?: RescueStatus.WAITING,
                timestamp = snapshot.child("timestamp").value?.toString()?.toLongOrNull(),
                confirmedBy = snapshot.child("confirmed_by").value?.toString(),
                reason = snapshot.child("reason").value?.toString()
            )
        }
    }
}

/** Cac gia tri status hop le tren Firebase (xem web/server rescueActionsService.js). */
object RescueStatus {
    const val WAITING = "waiting"
    const val CONFIRMED = "confirmed"
    const val RESCUING = "rescuing"
    const val RESCUED = "rescued"
    const val FAILED = "failed"
    const val CANCELLED = "cancelled"

    /** Trang thai con dang can doi cuu ho xu ly (chua ket thuc). */
    fun isActive(status: String): Boolean = status !in setOf(RESCUED, FAILED, CANCELLED)

    /** Nhan tieng Viet hien thi cho doi cuu ho (xem section 15 cua yeu cau). */
    fun label(context: Context, status: String): String = when (status) {
        WAITING -> context.getString(R.string.status_waiting)
        CONFIRMED -> context.getString(R.string.status_confirmed)
        RESCUING -> context.getString(R.string.status_rescuing)
        RESCUED -> context.getString(R.string.status_rescued)
        FAILED -> context.getString(R.string.status_failed)
        CANCELLED -> context.getString(R.string.status_cancelled)
        else -> context.getString(R.string.status_unknown)
    }
}
