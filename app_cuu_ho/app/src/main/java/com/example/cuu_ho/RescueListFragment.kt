package com.example.cuu_ho

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.os.bundleOf
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.example.cuu_ho.data.RescueRepository
import com.example.cuu_ho.databinding.FragmentRescueListBinding
import com.example.cuu_ho.databinding.ItemRescueRequestBinding
import com.example.cuu_ho.model.RescueRequest
import com.example.cuu_ho.model.RescueStatus
import java.util.Locale

/**
 * Man hinh chinh cua doi cuu ho: hien danh sach cac yeu cau cuu ho dang
 * hoat dong (SOS/CONFIRMED/RESCUING), cap nhat realtime tu Firebase qua
 * [RescueRepository]. Bam vao 1 the -> mo [RescueDetailFragment].
 */
class RescueListFragment : Fragment() {

    private var _binding: FragmentRescueListBinding? = null
    private val binding get() = _binding!!

    private val observer: (List<RescueRequest>) -> Unit = { requests -> renderList(requests) }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentRescueListBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onStart() {
        super.onStart()
        RescueRepository.observe(observer)
    }

    override fun onStop() {
        super.onStop()
        RescueRepository.removeObserver(observer)
    }

    private fun renderList(requests: List<RescueRequest>) {
        val binding = _binding ?: return
        val active = requests.filter { RescueStatus.isActive(it.status) }

        binding.emptyState.visibility = if (active.isEmpty()) View.VISIBLE else View.GONE
        binding.requestContainer.removeAllViews()

        active.forEach { request ->
            val item = ItemRescueRequestBinding.inflate(layoutInflater, binding.requestContainer, false)
            item.textStatusBadge.text = RescueStatus.label(requireContext(), request.status)
            item.textDeviceId.text = request.deviceId
            item.textMessage.text = request.message ?: getString(R.string.status_unknown)
            item.textCoordinates.text = String.format(
                Locale.US, "%.6f, %.6f", request.latitude, request.longitude
            )
            item.root.setOnClickListener {
                findNavController().navigate(
                    R.id.action_list_to_detail,
                    bundleOf("deviceId" to request.deviceId)
                )
            }
            binding.requestContainer.addView(item.root)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
