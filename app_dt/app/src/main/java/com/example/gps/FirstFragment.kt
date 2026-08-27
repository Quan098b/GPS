package com.example.gps

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import com.example.gps.databinding.FragmentFirstBinding
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.UUID

class FirstFragment : Fragment(), LocationListener {

    private var _binding: FragmentFirstBinding? = null
    private val binding get() = _binding!!

    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var bluetoothAdapter: BluetoothAdapter
    private lateinit var locationManager: LocationManager
    private var bluetoothGatt: BluetoothGatt? = null
    private var gpsCharacteristic: BluetoothGattCharacteristic? = null
    private var scanning = false
    private var trackingLocation = false
    private var bleReady = false
    private var pendingManualSend = false
    private var latestLocation: Location? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions.values.all { it }) ensureBluetoothAndScan()
        else showStatus("Can cap quyen Vi tri va Thiet bi o gan")
    }

    private val enableBluetoothLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        if (bluetoothAdapter.isEnabled) startScan()
        else showStatus("Bluetooth chua duoc bat")
    }

    private val scanTimeout = Runnable {
        if (scanning) {
            stopScan()
            showStatus("Khong tim thay $DEVICE_NAME. Hay bat ESP32 roi thu lai.")
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentFirstBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val bluetoothManager = requireContext()
            .getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bluetoothAdapter = bluetoothManager.adapter
        locationManager = requireContext()
            .getSystemService(Context.LOCATION_SERVICE) as LocationManager

        binding.buttonConnect.setOnClickListener {
            if (bluetoothGatt != null) disconnect() else requestPermissionsAndScan()
        }

        binding.buttonSendRescue.isEnabled = false
        binding.buttonSendRescue.setOnClickListener {
            onSendRescueClicked()
        }
    }

    private fun requiredPermissions(): Array<String> = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            add(Manifest.permission.BLUETOOTH_SCAN)
            add(Manifest.permission.BLUETOOTH_CONNECT)
        }
    }.toTypedArray()

    private fun requestPermissionsAndScan() {
        val missing = requiredPermissions().filter {
            ContextCompat.checkSelfPermission(requireContext(), it) !=
                PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) ensureBluetoothAndScan()
        else permissionLauncher.launch(missing.toTypedArray())
    }

    @SuppressLint("MissingPermission")
    private fun ensureBluetoothAndScan() {
        if (!hasAllPermissions()) return
        if (!bluetoothAdapter.isEnabled) {
            enableBluetoothLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            return
        }
        startScan()
    }

    private fun hasAllPermissions() = requiredPermissions().all {
        ContextCompat.checkSelfPermission(requireContext(), it) == PackageManager.PERMISSION_GRANTED
    }

    @SuppressLint("MissingPermission")
    private fun startScan() {
        if (scanning) return
        val scanner = bluetoothAdapter.bluetoothLeScanner
        if (scanner == null) {
            showStatus("Dien thoai khong ho tro quet BLE")
            return
        }
        Log.d(TAG, "Bat dau quet BLE (khong loc Service UUID, loc theo ten $DEVICE_NAME)")
        showStatus("Dang tim $DEVICE_NAME...")
        scanning = true
        binding.buttonConnect.isEnabled = false
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        scanner.startScan(null, settings, scanCallback)
        mainHandler.postDelayed(scanTimeout, SCAN_TIMEOUT_MS)
    }

    @SuppressLint("MissingPermission")
    private fun stopScan() {
        if (!scanning) return
        scanning = false
        mainHandler.removeCallbacks(scanTimeout)
        bluetoothAdapter.bluetoothLeScanner?.stopScan(scanCallback)
        _binding?.buttonConnect?.isEnabled = true
    }

    private val scanCallback = object : ScanCallback() {
        @SuppressLint("MissingPermission")
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            if (!scanning) return
            val name = result.device.name ?: result.scanRecord?.deviceName
            if (name != DEVICE_NAME) return
            Log.d(TAG, "Tim thay $DEVICE_NAME, dia chi: ${result.device.address}")
            stopScan()
            val appContext = this@FirstFragment.context ?: return
            showStatus("Tim thay $DEVICE_NAME, dang ket noi...")
            Log.d(TAG, "Goi connectGatt toi ${result.device.address}")
            bluetoothGatt = result.device.connectGatt(
                appContext,
                false,
                gattCallback,
                BluetoothDevice.TRANSPORT_LE
            )
        }

        override fun onScanFailed(errorCode: Int) {
            scanning = false
            mainHandler.removeCallbacks(scanTimeout)
            Log.e(TAG, "Quet BLE loi: $errorCode")
            showStatus("Quet BLE loi: $errorCode")
            mainHandler.post { _binding?.buttonConnect?.isEnabled = true }
        }
    }

    private val gattCallback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            Log.d(TAG, "onConnectionStateChange status=$status newState=$newState")
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    showStatus("Da ket noi ESP32, dang doc dich vu...")
                    gatt.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.d(TAG, "Da ngat ket noi BLE")
                    gpsCharacteristic = null
                    bleReady = false
                    pendingManualSend = false
                    bluetoothGatt = null
                    gatt.close()
                    stopLocationTracking()
                    showDisconnected("Da ngat ket noi")
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            Log.d(TAG, "onServicesDiscovered status=$status")
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.e(TAG, "discoverServices that bai, status=$status")
                showStatus("Doc dich vu BLE that bai")
                disconnect()
                return
            }
            val service = gatt.getService(SERVICE_UUID)
            if (service == null) {
                Log.e(TAG, "Khong tim thay Service $SERVICE_UUID")
                showStatus("ESP32 khong co dich vu GPS yeu cau")
                disconnect()
                return
            }
            Log.d(TAG, "Da tim thay Service $SERVICE_UUID")
            val characteristic = service.getCharacteristic(CHARACTERISTIC_UUID)
            if (characteristic == null) {
                Log.e(TAG, "Khong tim thay Characteristic $CHARACTERISTIC_UUID")
                showStatus("ESP32 khong co characteristic GPS yeu cau")
                disconnect()
                return
            }
            Log.d(TAG, "Da tim thay Characteristic $CHARACTERISTIC_UUID, BLE san sang")
            gpsCharacteristic = characteristic
            bleReady = true
            mainHandler.post {
                _binding?.apply {
                    buttonConnect.text = getString(R.string.disconnect)
                    buttonConnect.isEnabled = true
                    buttonSendRescue.isEnabled = true
                    textStatus.text = "Da ket noi ESP32. Dang lay vi tri..."
                }
                startLocationTracking()
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun disconnect() {
        Log.d(TAG, "disconnect() duoc goi")
        stopScan()
        stopLocationTracking()
        gpsCharacteristic = null
        bleReady = false
        pendingManualSend = false
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
        showDisconnected("Chua ket noi")
    }

    @SuppressLint("MissingPermission")
    private fun startLocationTracking() {
        if (trackingLocation || !hasAllPermissions() || !bleReady) return
        val gpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
        val networkEnabled = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        if (!gpsEnabled && !networkEnabled) {
            Toast.makeText(requireContext(), "Hay bat Vi tri tren dien thoai", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            return
        }
        trackingLocation = true
        if (gpsEnabled) locationManager.requestLocationUpdates(
            LocationManager.GPS_PROVIDER, LOCATION_INTERVAL_MS, 1f, this
        )
        if (networkEnabled) locationManager.requestLocationUpdates(
            LocationManager.NETWORK_PROVIDER, LOCATION_INTERVAL_MS, 1f, this
        )
    }

    private fun stopLocationTracking() {
        trackingLocation = false
        if (::locationManager.isInitialized) locationManager.removeUpdates(this)
    }

    override fun onLocationChanged(location: Location) {
        latestLocation = location
        _binding?.textLocation?.text = String.format(
            Locale.US,
            "Vi do: %.6f\nKinh do: %.6f\nSai so: %.1f m",
            location.latitude,
            location.longitude,
            location.accuracy
        )
        if (pendingManualSend) {
            sendRescueRequest()
        } else {
            _binding?.textStatus?.text = "San sang gui yeu cau cuu ho"
        }
    }

    private fun onSendRescueClicked() {
        if (!bleReady || bluetoothGatt == null) {
            showStatus("Chua ket noi ESP32")
            return
        }
        if (latestLocation == null) {
            pendingManualSend = true
            showStatus("Dang cho vi tri GPS...")
            return
        }
        sendRescueRequest()
    }

    private fun sendRescueRequest() {
        val location = latestLocation
        if (location == null) {
            pendingManualSend = true
            showStatus("Dang cho vi tri GPS...")
            return
        }

        val rawMessage = _binding?.editMessage?.text?.toString()?.trim().orEmpty()
        val safeMessage = if (rawMessage.isEmpty()) {
            DEFAULT_MESSAGE
        } else {
            rawMessage
                .replace("|", " ")
                .replace("\n", " ")
                .replace("\r", " ")
                .trim()
        }

        val timestamp = if (location.time > 0) location.time else System.currentTimeMillis()

        val payload = String.format(
            Locale.US,
            "SOS|%s|%.6f|%.6f|%.1f|%d|%s\n",
            DEVICE_ID,
            location.latitude,
            location.longitude,
            location.accuracy,
            timestamp,
            safeMessage
        )

        if (writePayload(payload)) {
            pendingManualSend = false
            _binding?.apply {
                textStatus.text = "Da gui yeu cau cuu ho"
                textLastPayload.text = "Da gui: ${payload.trim()}"
            }
        } else {
            pendingManualSend = false
            _binding?.textStatus?.text = "Gui yeu cau cuu ho that bai"
        }
    }

    @SuppressLint("MissingPermission")
    private fun writePayload(payload: String): Boolean {
        val gatt = bluetoothGatt ?: return false
        val characteristic = gpsCharacteristic ?: return false
        val bytes = payload.toByteArray(StandardCharsets.UTF_8)
        val success = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(
                characteristic,
                bytes,
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            ) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            characteristic.value = bytes
            @Suppress("DEPRECATION")
            gatt.writeCharacteristic(characteristic)
        }
        if (success) Log.d(TAG, "BLE write thanh cong (${bytes.size} bytes)")
        else Log.e(TAG, "BLE write that bai")
        return success
    }

    private fun showStatus(message: String) {
        mainHandler.post { _binding?.textStatus?.text = message }
    }

    private fun showDisconnected(message: String) {
        mainHandler.post {
            _binding?.apply {
                textStatus.text = message
                buttonConnect.text = getString(R.string.connect)
                buttonConnect.isEnabled = true
                buttonSendRescue.isEnabled = false
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (bleReady && !trackingLocation && hasAllPermissions()) {
            startLocationTracking()
        }
    }

    override fun onDestroyView() {
        stopLocationTracking()
        stopScan()
        bluetoothGatt?.close()
        bluetoothGatt = null
        gpsCharacteristic = null
        bleReady = false
        pendingManualSend = false
        _binding = null
        super.onDestroyView()
    }

    companion object {
        private const val TAG = "GPS_BLE"
        private const val DEVICE_NAME = "GPS-ESP32"
        private const val DEVICE_ID = "RESCUE-001"
        private const val DEFAULT_MESSAGE = "Can cuu ho"
        private const val SCAN_TIMEOUT_MS = 10_000L
        private const val LOCATION_INTERVAL_MS = 2_000L
        val SERVICE_UUID: UUID = UUID.fromString("12345678-1234-5678-1234-56789abcdef0")
        val CHARACTERISTIC_UUID: UUID = UUID.fromString("12345678-1234-5678-1234-56789abcdef1")
    }
}
