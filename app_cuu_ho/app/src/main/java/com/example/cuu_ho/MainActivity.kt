package com.example.cuu_ho

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.example.cuu_ho.data.RescueRepository
import androidx.navigation.NavController
import androidx.navigation.fragment.NavHostFragment
import androidx.navigation.ui.AppBarConfiguration
import androidx.navigation.ui.navigateUp
import androidx.navigation.ui.setupActionBarWithNavController
import com.example.cuu_ho.databinding.ActivityMainBinding
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : AppCompatActivity() {

    private lateinit var appBarConfiguration: AppBarConfiguration
    private lateinit var binding: ActivityMainBinding
    private lateinit var navController: NavController

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!granted) {
            // Khong crash, chi bao cho nguoi dung biet se khong nhan duoc canh bao.
            android.widget.Toast.makeText(
                this,
                getString(R.string.toast_notification_permission_denied),
                android.widget.Toast.LENGTH_LONG
            ).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.main) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }
        setSupportActionBar(binding.toolbar)

        val navHostFragment =
            supportFragmentManager.findFragmentById(R.id.nav_host_fragment_content_main) as NavHostFragment
        navController = navHostFragment.navController

        appBarConfiguration = AppBarConfiguration(navController.graph)
        setupActionBarWithNavController(navController, appBarConfiguration)

        RescueFirebaseMessagingService.ensureChannel(this)
        requestNotificationPermissionIfNeeded()
        subscribeToRescueTeamTopic()

        handleNotificationIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleNotificationIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        RescueRepository.start()
    }

    override fun onStop() {
        super.onStop()
        RescueRepository.stop()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun subscribeToRescueTeamTopic() {
        FirebaseMessaging.getInstance().subscribeToTopic(getString(R.string.rescue_team_topic))
            .addOnCompleteListener { task ->
                if (task.isSuccessful) Log.d(TAG, "Da subscribe topic rescue_team")
                else Log.w(TAG, "Subscribe topic rescue_team that bai", task.exception)
            }
    }

    /**
     * Neu Intent den tu khi nguoi dung nham vao notification FCM (co
     * device_id trong extras), dieu huong thang toi man hinh chi tiet yeu
     * cau cuu ho tuong ung. Neu app da mo san, khong tao lai Activity/luong
     * dieu huong trung lap (nho launchMode singleTop + onNewIntent).
     */
    private fun handleNotificationIntent(intent: Intent?) {
        val deviceId = intent?.getStringExtra(EXTRA_DEVICE_ID) ?: return
        if (navController.currentDestination?.id == R.id.RescueDetailFragment &&
            navController.currentBackStackEntry?.arguments?.getString(ARG_DEVICE_ID) == deviceId
        ) {
            return
        }
        navController.navigate(R.id.RescueDetailFragment, bundleOf(ARG_DEVICE_ID to deviceId))
    }

    override fun onSupportNavigateUp(): Boolean = navController.navigateUp(appBarConfiguration) || super.onSupportNavigateUp()

    companion object {
        private const val TAG = "MainActivity"

        const val ARG_DEVICE_ID = "deviceId"
        const val EXTRA_DEVICE_ID = "device_id"
        const val EXTRA_LATITUDE = "latitude"
        const val EXTRA_LONGITUDE = "longitude"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_TIMESTAMP = "timestamp"
    }
}
