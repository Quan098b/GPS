package com.example.gps

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
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
import android.os.ParcelUuid
import android.provider.Settings
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
    private var notificationsReady = false
    private var pendingButtonRequest = false
    private var latestPayload: String? = null

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
        showStatus("Dang tim $DEVICE_NAME...")
        scanning = true
        binding.buttonConnect.isEnabled = false
        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        scanner.startScan(listOf(filter), settings, scanCallback)
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
            stopScan()
            val appContext = this@FirstFragment.context ?: return
            showStatus("Dang ket noi ${result.device.name ?: DEVICE_NAME}...")
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
            showStatus("Quet BLE loi: $errorCode")
            mainHandler.post { _binding?.buttonConnect?.isEnabled = true }
        }
    }

    private val gattCallback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    showStatus("Da ket noi, dang doc dich vu...")
                    if (!gatt.requestMtu(128)) gatt.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    gpsCharacteristic = null
                    notificationsReady = false
                    pendingButtonRequest = false
                    bluetoothGatt = null
                    gatt.close()
                    stopLocationTracking()
                    showDisconnected("Da ngat ket noi")
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            gatt.discoverServices()
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val characteristic = gatt.getService(SERVICE_UUID)
                ?.getCharacteristic(CHARACTERISTIC_UUID)
            if (status != BluetoothGatt.GATT_SUCCESS || characteristic == null) {
                showStatus("ESP32 khong co dich vu GPS yeu cau")
                disconnect()
                return
            }
            gpsCharacteristic = characteristic
            if (!enableButtonNotifications(gatt, characteristic)) {
                showStatus("Khong the bat thong bao nut nhan")
                disconnect()
            }
        }

        override fun onDescriptorWrite(
            gatt: BluetoothGatt,
            descriptor: BluetoothGattDescriptor,
            status: Int
        ) {
            if (descriptor.uuid != CLIENT_CONFIG_UUID) return
            if (status != BluetoothGatt.GATT_SUCCESS) {
                showStatus("Khong the nhan lenh tu nut ESP32")
                disconnect()
                return
            }
            notificationsReady = true
            mainHandler.post {
                _binding?.apply {
                    buttonConnect.text = getString(R.string.disconnect)
                    buttonConnect.isEnabled = true
                }
                startLocationTracking()
            }
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray
        ) {
            handleEspCommand(value)
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            handleEspCommand(characteristic.value ?: return)
        }
    }

    @SuppressLint("MissingPermission")
    private fun enableButtonNotifications(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic
    ): Boolean {
        if (!gatt.setCharacteristicNotification(characteristic, true)) return false
        val descriptor = characteristic.getDescriptor(CLIENT_CONFIG_UUID) ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeDescriptor(
                descriptor,
                BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            ) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            @Suppress("DEPRECATION")
            gatt.writeDescriptor(descriptor)
        }
    }

    @SuppressLint("MissingPermission")
    private fun disconnect() {
        stopScan()
        stopLocationTracking()
        gpsCharacteristic = null
        notificationsReady = false
        pendingButtonRequest = false
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
        showDisconnected("Chua ket noi")
    }

    @SuppressLint("MissingPermission")
    private fun startLocationTracking() {
        if (trackingLocation || !hasAllPermissions() || !notificationsReady) return
        val gpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
        val networkEnabled = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        if (!gpsEnabled && !networkEnabled) {
            Toast.makeText(requireContext(), "Hay bat Vi tri tren dien thoai", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            return
        }
        trackingLocation = true
        binding.textStatus.text = "Da ket noi. Dang cho vi tri..."
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
        val payload = String.format(
            Locale.US,
            "GPS,%.6f,%.6f,%.1f,%d\n",
            location.latitude,
            location.longitude,
            location.accuracy,
            location.time
        )
        latestPayload = payload
        _binding?.textLocation?.text = String.format(
            Locale.US,
            "Vi do: %.6f\nKinh do: %.6f\nSai so: %.1f m",
            location.latitude,
            location.longitude,
            location.accuracy
        )
        if (pendingButtonRequest) sendLatestLocation()
        else _binding?.textStatus?.text = "San sang. Hay nhan nut GPIO 3"
    }

    private fun handleEspCommand(value: ByteArray) {
        if (String(value, StandardCharsets.UTF_8).trim() != BUTTON_COMMAND) return
        mainHandler.post {
            pendingButtonRequest = true
            if (latestPayload == null) {
                _binding?.textStatus?.text = "Da nhan nut, dang cho GPS..."
            } else {
                sendLatestLocation()
            }
        }
    }

    private fun sendLatestLocation() {
        val payload = latestPayload ?: return
        if (writePayload(payload)) {
            pendingButtonRequest = false
            _binding?.apply {
                textStatus.text = "Da gui vi tri do nut GPIO 3"
                textLastPayload.text = "Da gui: ${payload.trim()}"
            }
        } else {
            pendingButtonRequest = false
            _binding?.textStatus?.text = "Gui BLE that bai, hay nhan lai"
        }
    }

    @SuppressLint("MissingPermission")
    private fun writePayload(payload: String): Boolean {
        val gatt = bluetoothGatt ?: return false
        val characteristic = gpsCharacteristic ?: return false
        val bytes = payload.toByteArray(StandardCharsets.UTF_8)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
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
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (notificationsReady && !trackingLocation && hasAllPermissions()) {
            startLocationTracking()
        }
    }

    override fun onDestroyView() {
        stopLocationTracking()
        stopScan()
        bluetoothGatt?.close()
        bluetoothGatt = null
        gpsCharacteristic = null
        notificationsReady = false
        pendingButtonRequest = false
        _binding = null
        super.onDestroyView()
    }

    companion object {
        private const val DEVICE_NAME = "GPS-ESP32"
        private const val BUTTON_COMMAND = "SEND"
        private const val SCAN_TIMEOUT_MS = 10_000L
        private const val LOCATION_INTERVAL_MS = 2_000L
        val SERVICE_UUID: UUID = UUID.fromString("12345678-1234-5678-1234-56789abcdef0")
        val CHARACTERISTIC_UUID: UUID = UUID.fromString("12345678-1234-5678-1234-56789abcdef1")
        val CLIENT_CONFIG_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }
}
