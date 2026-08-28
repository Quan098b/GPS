package com.example.cuu_ho

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.example.cuu_ho.data.RescueActions
import com.example.cuu_ho.data.RescueRepository
import com.example.cuu_ho.databinding.FragmentRescueDetailBinding
import com.example.cuu_ho.model.RescueRequest
import com.example.cuu_ho.model.RescueStatus
import com.google.android.material.button.MaterialButton
import java.util.Locale

/**
 * Chi tiet 1 yeu cau cuu ho + toan bo hanh dong cua doi cuu ho: xac nhan,
 * chi duong, bat dau di chuyen, cuu ho thanh cong/that bai, huy. Moi hanh
 * dong chi ghi vao Firebase /rescue_actions/{deviceId} - khong goi API
 * backend/MySQL truc tiep (xem data/RescueActions.kt).
 */
class RescueDetailFragment : Fragment() {

    private var _binding: FragmentRescueDetailBinding? = null
    private val binding get() = _binding!!

    private val deviceId: String by lazy { requireArguments().getString(ARG_DEVICE_ID).orEmpty() }
    private var lastKnownLocation: Location? = null
    private var hasRenderedOnce = false

    private val observer: (List<RescueRequest>) -> Unit = { requests ->
        val current = requests.firstOrNull { it.deviceId == deviceId }
        if (current == null) {
            if (hasRenderedOnce && findNavController().currentDestination?.id == R.id.RescueDetailFragment) {
                findNavController().popBackStack()
            }
        } else {
            hasRenderedOnce = true
            render(current)
        }
    }

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) updateDistanceFromLastKnownLocation() }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentRescueDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onStart() {
        super.onStart()
        RescueRepository.observe(observer)
        requestLocationIfNeeded()
    }

    override fun onStop() {
        super.onStop()
        RescueRepository.removeObserver(observer)
    }

    private fun render(request: RescueRequest) {
        val binding = _binding ?: return
        binding.textDeviceId.text = request.deviceId
        binding.textStatus.text = RescueStatus.label(requireContext(), request.status)
        binding.textMessage.text = request.message ?: getString(R.string.status_unknown)
        binding.textLocation.text = String.format(Locale.US, "%.6f, %.6f", request.latitude, request.longitude)
        binding.textAccuracy.text = if (request.accuracy != null) {
            getString(R.string.label_accuracy) + ": " + String.format(Locale.US, "%.1f m", request.accuracy)
        } else {
            ""
        }

        updateDistanceLabel(request)
        renderActions(request)
    }

    // ======================================================
    // NUT HANH DONG THEO TRANG THAI
    // ======================================================

    private fun renderActions(request: RescueRequest) {
        val binding = _binding ?: return
        binding.actionContainer.removeAllViews()

        when (request.status) {
            RescueStatus.WAITING -> {
                addActionButton(getString(R.string.action_confirm)) {
                    RescueRepository.applyOptimisticStatus(deviceId, RescueStatus.CONFIRMED)
                    RescueActions.confirm(deviceId)
                    notifyActionSent()
                }
            }
            RescueStatus.CONFIRMED -> {
                addActionButton(getString(R.string.action_navigate)) { openNavigation(request) }
                addActionButton(getString(R.string.action_start_rescue)) {
                    RescueRepository.applyOptimisticStatus(deviceId, RescueStatus.RESCUING)
                    RescueActions.startRescue(deviceId)
                    notifyActionSent()
                }
                addActionButton(getString(R.string.action_cancel), destructive = true) { confirmCancel() }
            }
            RescueStatus.RESCUING -> {
                addActionButton(getString(R.string.action_navigate)) { openNavigation(request) }
                addActionButton(getString(R.string.action_rescued)) { confirmRescued() }
                addActionButton(getString(R.string.action_failed), destructive = true) { showFailedDialog() }
            }
            else -> {
                // RESCUED / FAILED / CANCELLED: trang thai cuoi, hien thi tam thoi
                // truoc khi node /sos/{deviceId} bi backend xoa - khong con hanh dong.
            }
        }
    }

    private fun addActionButton(label: String, destructive: Boolean = false, onClick: () -> Unit) {
        val binding = _binding ?: return
        val button = MaterialButton(requireContext()).apply {
            text = label
            isAllCaps = false
            textSize = 16f
            setPadding(0, 40, 0, 40)
            if (destructive) {
                setTextColor(ContextCompat.getColor(requireContext(), android.R.color.holo_red_dark))
                strokeColor = ContextCompat.getColorStateList(requireContext(), android.R.color.holo_red_dark)
                setBackgroundColor(ContextCompat.getColor(requireContext(), android.R.color.transparent))
            }
            setOnClickListener { onClick() }
        }
        val params = android.widget.LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = 24 }
        binding.actionContainer.addView(button, params)
    }

    private fun notifyActionSent() {
        Toast.makeText(requireContext(), R.string.toast_action_sent, Toast.LENGTH_SHORT).show()
    }

    // ======================================================
    // DIALOG XAC NHAN
    // ======================================================

    private fun confirmRescued() {
        AlertDialog.Builder(requireContext())
            .setTitle(R.string.dialog_confirm_rescued_title)
            .setMessage(R.string.dialog_confirm_rescued_message)
            .setPositiveButton(R.string.btn_yes) { _, _ ->
                RescueRepository.applyOptimisticStatus(deviceId, RescueStatus.RESCUED)
                RescueActions.rescued(deviceId)
                notifyActionSent()
            }
            .setNegativeButton(R.string.btn_no, null)
            .show()
    }

    private fun showFailedDialog() {
        val input = EditText(requireContext()).apply {
            hint = getString(R.string.dialog_failed_hint)
            setPadding(48, 32, 48, 32)
        }
        AlertDialog.Builder(requireContext())
            .setTitle(R.string.dialog_failed_title)
            .setView(input)
            .setPositiveButton(R.string.btn_send) { _, _ ->
                val reason = input.text?.toString()?.trim().orEmpty()
                RescueRepository.applyOptimisticStatus(deviceId, RescueStatus.FAILED)
                RescueActions.failed(deviceId, reason.ifEmpty { getString(R.string.status_unknown) })
                notifyActionSent()
            }
            .setNegativeButton(R.string.btn_cancel, null)
            .show()
    }

    private fun confirmCancel() {
        AlertDialog.Builder(requireContext())
            .setTitle(R.string.dialog_cancel_title)
            .setPositiveButton(R.string.btn_yes) { _, _ ->
                RescueRepository.applyOptimisticStatus(deviceId, RescueStatus.CANCELLED)
                RescueActions.cancel(deviceId)
                notifyActionSent()
            }
            .setNegativeButton(R.string.btn_no, null)
            .show()
    }

    // ======================================================
    // CHI DUONG (GOOGLE MAPS)
    // ======================================================

    private fun openNavigation(request: RescueRequest) {
        val lat = request.latitude
        val lng = request.longitude

        val googleMapsUri = Uri.parse(String.format(Locale.US, "google.navigation:q=%.6f,%.6f", lat, lng))
        val googleMapsIntent = Intent(Intent.ACTION_VIEW, googleMapsUri).apply {
            setPackage("com.google.android.apps.maps")
        }
        if (googleMapsIntent.resolveActivity(requireActivity().packageManager) != null) {
            startActivity(googleMapsIntent)
            return
        }

        val geoUri = Uri.parse(String.format(Locale.US, "geo:%.6f,%.6f?q=%.6f,%.6f", lat, lng, lat, lng))
        val geoIntent = Intent(Intent.ACTION_VIEW, geoUri)
        if (geoIntent.resolveActivity(requireActivity().packageManager) != null) {
            startActivity(geoIntent)
            return
        }

        Toast.makeText(requireContext(), R.string.toast_no_maps_app, Toast.LENGTH_LONG).show()
    }

    // ======================================================
    // KHOANG CACH (TUY CHON, KHONG BAT BUOC)
    // ======================================================

    private fun requestLocationIfNeeded() {
        val hasPermission = ContextCompat.checkSelfPermission(requireContext(), Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (hasPermission) updateDistanceFromLastKnownLocation()
        else locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    @SuppressLint("MissingPermission")
    private fun updateDistanceFromLastKnownLocation() {
        val hasPermission = ContextCompat.checkSelfPermission(requireContext(), Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!hasPermission) return
        val locationManager = requireContext().getSystemService(LocationManager::class.java) ?: return
        lastKnownLocation = try {
            locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
        } catch (error: SecurityException) {
            null
        }
        RescueRepository.current(deviceId)?.let { updateDistanceLabel(it) }
    }

    private fun updateDistanceLabel(request: RescueRequest) {
        val binding = _binding ?: return
        val rescuer = lastKnownLocation
        if (rescuer == null) {
            binding.textDistance.visibility = View.GONE
            return
        }
        val result = FloatArray(1)
        Location.distanceBetween(rescuer.latitude, rescuer.longitude, request.latitude, request.longitude, result)
        val meters = result[0]
        val label = if (meters < 1000) {
            String.format(Locale.US, "%s: %d m", getString(R.string.label_distance), meters.toInt())
        } else {
            String.format(Locale.US, "%s: %.1f km", getString(R.string.label_distance), meters / 1000)
        }
        binding.textDistance.text = label
        binding.textDistance.visibility = View.VISIBLE
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val ARG_DEVICE_ID = "deviceId"
    }
}
