package com.example.cuu_ho.data

import android.os.Handler
import android.os.Looper
import com.example.cuu_ho.model.RescueRequest
import com.google.firebase.database.ChildEventListener
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase

/**
 * Nguon du lieu duy nhat cho man hinh doi cuu ho: lang nghe realtime tren
 * /sos (Firebase Realtime Database) va giu 1 ban sao trong bo nho de nhieu
 * Fragment cung quan sat ma khong can tao nhieu ket noi/listener rieng.
 *
 * Ho tro nhieu yeu cau cuu ho dong thoi (nhieu device_id duoi /sos).
 */
object RescueRepository {

    private val database by lazy { FirebaseDatabase.getInstance() }
    private val mainHandler = Handler(Looper.getMainLooper())

    private val requests = linkedMapOf<String, RescueRequest>()
    private val observers = mutableListOf<(List<RescueRequest>) -> Unit>()

    private var childListener: ChildEventListener? = null
    private var started = false

    fun start() {
        if (started) return
        started = true
        val ref = database.getReference("sos")
        val listener = object : ChildEventListener {
            override fun onChildAdded(snapshot: DataSnapshot, previousChildName: String?) = upsert(snapshot)
            override fun onChildChanged(snapshot: DataSnapshot, previousChildName: String?) = upsert(snapshot)
            override fun onChildRemoved(snapshot: DataSnapshot) {
                val deviceId = snapshot.key ?: return
                mainHandler.post {
                    requests.remove(deviceId)
                    notifyObservers()
                }
            }
            override fun onChildMoved(snapshot: DataSnapshot, previousChildName: String?) {}
            override fun onCancelled(error: DatabaseError) {}
        }
        ref.addChildEventListener(listener)
        childListener = listener
    }

    fun stop() {
        val listener = childListener ?: return
        database.getReference("sos").removeEventListener(listener)
        childListener = null
        started = false
    }

    private fun upsert(snapshot: DataSnapshot) {
        val request = RescueRequest.fromSnapshot(snapshot) ?: return
        mainHandler.post {
            requests[request.deviceId] = request
            notifyObservers()
        }
    }

    private fun notifyObservers() {
        val snapshot = requests.values.toList()
        observers.forEach { it(snapshot) }
    }

    /** Goi callback ngay voi du lieu hien co, roi tiep tuc goi moi khi thay doi. */
    fun observe(callback: (List<RescueRequest>) -> Unit) {
        observers.add(callback)
        callback(requests.values.toList())
    }

    fun removeObserver(callback: (List<RescueRequest>) -> Unit) {
        observers.remove(callback)
    }

    fun current(deviceId: String): RescueRequest? = requests[deviceId]

    /**
     * Cap nhat trang thai NGAY tren giao dien khi doi cuu ho bam nut hanh
     * dong, khong cho UI cho vong round-trip qua Firebase/backend. Viec ghi
     * /rescue_actions chi la "bao cho server biet" chay nen (xem
     * data/RescueActions.kt) - doi cuu ho khong can server duyet truoc khi
     * tiep tuc thao tac (chi duong, di chuyen...).
     *
     * Du lieu that tu backend (qua listener /sos) se den sau va ghi de len
     * gia tri lac quan nay - neu trung thi khong doi gi, neu backend tu choi
     * (vi du transition khong hop le) thi UI se tu dieu chinh lai theo du
     * lieu that ngay khi no ve.
     */
    fun applyOptimisticStatus(deviceId: String, status: String) {
        val current = requests[deviceId] ?: return
        if (current.status == status) return
        requests[deviceId] = current.copy(status = status)
        // Goi truc tiep (khong post) - ham nay luon duoc goi tu UI thread
        // (nguoi dung bam nut), can phan hoi ngay lap tuc trong cung frame.
        notifyObservers()
    }
}
