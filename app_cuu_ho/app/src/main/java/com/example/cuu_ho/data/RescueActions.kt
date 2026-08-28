package com.example.cuu_ho.data

import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue

/**
 * Ghi hanh dong cua doi cuu ho vao /rescue_actions/{deviceId}. Backend
 * (web/server/services/rescueActionsService.js) lang nghe path nay, thuc
 * hien transition trong MySQL, roi xoa node action sau khi xu ly xong.
 *
 * App KHONG ket noi truc tiep MySQL - chi ghi action, doc trang thai ket
 * qua qua /sos/{deviceId}/status (RescueRepository).
 */
object RescueActions {

    private const val TEAM_ID = "RESCUE-TEAM-01"

    private val database by lazy { FirebaseDatabase.getInstance() }

    private fun send(deviceId: String, action: String, extra: Map<String, Any?> = emptyMap()) {
        val payload = mutableMapOf<String, Any?>(
            "action" to action,
            "device_id" to deviceId,
            "team_id" to TEAM_ID,
            "timestamp" to ServerValue.TIMESTAMP
        )
        payload.putAll(extra)
        database.getReference("rescue_actions").child(deviceId).setValue(payload)
    }

    fun confirm(deviceId: String) = send(deviceId, "CONFIRM")

    fun startRescue(deviceId: String) = send(deviceId, "START_RESCUE")

    fun rescued(deviceId: String) = send(deviceId, "RESCUED")

    fun failed(deviceId: String, reason: String) = send(deviceId, "FAILED", mapOf("reason" to reason))

    fun cancel(deviceId: String) = send(deviceId, "CANCEL")
}
