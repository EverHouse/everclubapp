import React from 'react';
import ModalShell from '../../../../components/ModalShell';
import Icon from '../../../../components/icons/Icon';
import { formatTime12Hour } from '../../../../utils/dateUtils';
import { formatDateShortAdmin } from '../simulator/simulatorUtils';
import { BOOKING_STATUS } from '../../../../../shared/constants/statuses';
import type { SimulatorModalsProps } from './simulatorModalTypes';

const SimulatorModals: React.FC<SimulatorModalsProps> = ({
  selectedRequest,
  actionModal,
  setActionModal,
  setSelectedRequest,
  error,
  setError,
  showTrackmanConfirm,
  setShowTrackmanConfirm,
  cancelConfirmModal,
  setCancelConfirmModal,
  feeEstimate,
  isFetchingFeeEstimate,
  resources,
  selectedBayId,
  setSelectedBayId,
  availabilityStatus,
  conflictDetails,
  staffNotes,
  setStaffNotes,
  suggestedTime,
  setSuggestedTime,
  declineAvailableSlots,
  declineSlotsLoading,
  declineSlotsError,
  isProcessing,
  guestFeeDollars,
  initiateApproval,
  handleApprove,
  handleDecline,
  performCancellation,
}) => {
  return (
    <>
      <ModalShell isOpen={!!actionModal && !!selectedRequest} onClose={() => { setActionModal(null); setSelectedRequest(null); setError(null); setShowTrackmanConfirm(false); }} title={actionModal === 'approve' ? 'Approve Request' : 'Decline Request'} showCloseButton={false}>
        <div className="p-6 space-y-4">
          <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-lg">
            <p className="font-medium text-primary dark:text-white">{selectedRequest?.user_name || selectedRequest?.user_email}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {selectedRequest && formatDateShortAdmin(selectedRequest.request_date)} • {selectedRequest && formatTime12Hour(selectedRequest.start_time)} - {selectedRequest && formatTime12Hour(selectedRequest.end_time)}
            </p>
            {selectedRequest?.declared_player_count != null && selectedRequest.declared_player_count > 0 && (
              <div className="flex items-center gap-1 mt-2 text-sm text-accent-dark dark:text-accent">
                <Icon name="group" className="text-base" />
                <span>{selectedRequest?.declared_player_count} {selectedRequest?.declared_player_count === 1 ? 'player' : 'players'}</span>
              </div>
            )}
          </div>
          {actionModal === 'approve' && (
            <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="payments" className="text-amber-600 dark:text-amber-400 text-base" />
                <p className="text-xs text-amber-700 dark:text-amber-300 font-medium uppercase tracking-wide">Fee Estimate</p>
              </div>
              {isFetchingFeeEstimate ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Icon name="progress_activity" className="animate-spin text-base" />
                  Calculating fees...
                </div>
              ) : feeEstimate ? (
                <div className="space-y-1.5">
                  {feeEstimate.ownerTier && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-400">Member tier</span>
                      <span className="text-gray-700 dark:text-gray-300 font-medium">{feeEstimate.ownerTier}</span>
                    </div>
                  )}
                  {feeEstimate.feeBreakdown.overageFee > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-400">Overage ({feeEstimate.feeBreakdown.overageMinutes} min)</span>
                      <span className="text-amber-700 dark:text-amber-300">${feeEstimate.feeBreakdown.overageFee}</span>
                    </div>
                  )}
                  {feeEstimate.feeBreakdown.guestCount > 0 && (
                    <>
                      {feeEstimate.feeBreakdown.guestsUsingPasses > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600 dark:text-gray-400">{feeEstimate.feeBreakdown.guestsUsingPasses} guest{feeEstimate.feeBreakdown.guestsUsingPasses > 1 ? 's' : ''} (using pass)</span>
                          <span className="text-green-600 dark:text-green-400">$0</span>
                        </div>
                      )}
                      {feeEstimate.feeBreakdown.guestsCharged > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600 dark:text-gray-400">{feeEstimate.feeBreakdown.guestsCharged} guest{feeEstimate.feeBreakdown.guestsCharged > 1 ? 's' : ''} @ ${String(feeEstimate.feeBreakdown.guestFeePerUnit || guestFeeDollars)}</span>
                          <span className="text-amber-700 dark:text-amber-300">${feeEstimate.feeBreakdown.guestFees}</span>
                        </div>
                      )}
                    </>
                  )}
                  {feeEstimate.feeBreakdown.guestPassesRemaining > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-400">Guest passes remaining</span>
                      <span className="text-gray-500 dark:text-gray-400">{feeEstimate.feeBreakdown.guestPassesRemaining}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t border-amber-200 dark:border-amber-500/30">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Owner pays</span>
                    <span className={`text-sm font-bold ${feeEstimate.totalFee > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-green-600 dark:text-green-400'}`}>
                      {feeEstimate.totalFee > 0 ? `$${feeEstimate.totalFee}` : 'No fees'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 italic">{feeEstimate.note}</p>
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">Unable to calculate fees</p>
              )}
            </div>
          )}
          {selectedRequest?.member_notes && (
            <div className="p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg">
              <p className="text-xs text-blue-600 dark:text-blue-400 mb-1 flex items-center gap-1">
                <Icon name="chat" className="text-sm" />
                Member Notes
              </p>
              <p className="text-sm text-primary dark:text-white">{selectedRequest?.member_notes}</p>
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
          {actionModal === 'approve' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Assign Resource *</label>
              <select
                value={selectedBayId || ''}
                onChange={(e) => setSelectedBayId(Number(e.target.value))}
                className="w-full p-3 rounded-lg border border-gray-200 dark:border-white/25 bg-gray-50 dark:bg-black/30 text-primary dark:text-white"
              >
                <option value="">Select a resource...</option>
                {resources.map(resource => (
                  <option key={resource.id} value={resource.id}>
                    {resource.type === 'conference_room' ? 'Conference Room' : resource.name}
                  </option>
                ))}
              </select>

              {selectedBayId && availabilityStatus && (
                <div className={`mt-2 p-2 rounded-lg flex items-center gap-2 text-sm ${
                  availabilityStatus === 'checking'
                    ? 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400'
                    : availabilityStatus === 'available'
                      ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400'
                      : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
                }`}>
                  <Icon name={availabilityStatus === 'checking' ? 'progress_activity' : availabilityStatus === 'available' ? 'check_circle' : 'warning'} className={`text-base ${availabilityStatus === 'checking' ? 'animate-spin' : ''}`} />
                  <span>
                    {availabilityStatus === 'checking' && 'Checking availability...'}
                    {availabilityStatus === 'available' && 'This time slot is available'}
                    {availabilityStatus === 'conflict' && (conflictDetails || 'Conflict detected')}
                  </span>
                </div>
              )}
            </div>
          )}
          {actionModal === 'decline' && selectedRequest?.status !== BOOKING_STATUS.APPROVED && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Suggest Alternative Time (Optional)</label>
              {declineSlotsError && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">{declineSlotsError}</p>
              )}
              <select
                value={suggestedTime || ''}
                onChange={(e) => setSuggestedTime(e.target.value)}
                disabled={declineSlotsLoading || !!declineSlotsError}
                className="w-full p-3 rounded-lg border border-gray-200 dark:border-white/25 bg-gray-50 dark:bg-black/30 text-primary dark:text-white disabled:opacity-50"
              >
                <option value="">
                  {declineSlotsLoading
                    ? 'Loading available times...'
                    : declineSlotsError
                      ? 'Unavailable'
                      : declineAvailableSlots.length === 0
                        ? 'No available times'
                        : 'Select alternative time...'}
                </option>
                {declineAvailableSlots.map((time) => (
                  <option key={time} value={time}>
                    {formatTime12Hour(time)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Staff Notes (Optional)</label>
            <textarea
              value={staffNotes}
              onChange={(e) => setStaffNotes(e.target.value)}
              placeholder="Add a note for the member..."
              rows={2}
              className="w-full p-3 rounded-lg border border-gray-200 dark:border-white/25 bg-gray-50 dark:bg-black/30 text-primary dark:text-white resize-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => { setActionModal(null); setSelectedRequest(null); setError(null); setShowTrackmanConfirm(false); }}
              className="flex-1 py-3 px-4 rounded-lg border border-gray-200 dark:border-white/25 text-gray-600 dark:text-gray-300 font-medium"
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              onClick={actionModal === 'approve' ? initiateApproval : handleDecline}
              disabled={isProcessing || (actionModal === 'approve' && (!selectedBayId || availabilityStatus === 'conflict' || availabilityStatus === 'checking'))}
              className={`flex-1 py-3 px-4 rounded-lg text-white font-medium flex items-center justify-center gap-2 ${
                actionModal === 'approve'
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-red-500 hover:bg-red-600'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing ? (
                <Icon name="progress_activity" className="animate-spin text-sm" />
              ) : (
                <Icon name={actionModal === 'approve' ? 'check' : 'close'} className="text-sm" />
              )}
              {actionModal === 'approve' ? 'Approve' : (selectedRequest?.status === BOOKING_STATUS.APPROVED ? 'Cancel Booking' : 'Decline')}
            </button>
          </div>
        </div>
      </ModalShell>

      <ModalShell isOpen={showTrackmanConfirm && !!selectedRequest} onClose={() => setShowTrackmanConfirm(false)} showCloseButton={false}>
        <div className="p-6 space-y-4">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center mx-auto mb-3">
              <Icon name="sports_golf" className="text-amber-600 dark:text-amber-400 text-2xl" />
            </div>
            <h3 className="text-2xl leading-tight font-bold text-primary dark:text-white mb-2" style={{ fontFamily: 'var(--font-headline)' }}>Trackman Confirmation</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Have you created this booking in Trackman?
            </p>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-lg text-sm">
            <p className="font-medium text-primary dark:text-white">{selectedRequest?.user_name || selectedRequest?.user_email}</p>
            <p className="text-gray-500 dark:text-gray-400">
              {selectedRequest && formatDateShortAdmin(selectedRequest.request_date)} • {selectedRequest && formatTime12Hour(selectedRequest.start_time)} - {selectedRequest && formatTime12Hour(selectedRequest.end_time)}
            </p>
            {selectedBayId && (
              <p className="text-gray-500 dark:text-gray-400">
                {resources.find(r => r.id === selectedBayId)?.name || `Bay ${selectedBayId}`}
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowTrackmanConfirm(false)}
              className="flex-1 py-3 px-4 rounded-lg border border-gray-200 dark:border-white/25 text-gray-600 dark:text-gray-300 font-medium"
              disabled={isProcessing}
            >
              Go Back
            </button>
            <button
              onClick={handleApprove}
              disabled={isProcessing}
              className="flex-1 py-3 px-4 rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <Icon name="progress_activity" className="animate-spin text-sm" />
              ) : (
                <Icon name="check" className="text-sm" />
              )}
              Yes, Approve
            </button>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        isOpen={cancelConfirmModal.isOpen}
        onClose={() => !cancelConfirmModal.isCancelling && setCancelConfirmModal({ isOpen: false, booking: null, hasTrackman: false, isCancelling: false, showSuccess: false })}
        showCloseButton={!cancelConfirmModal.isCancelling}
      >
        <div className="p-6">
          {!cancelConfirmModal.showSuccess ? (
            <>
              <div className="flex items-center justify-center mb-4">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center ${cancelConfirmModal.hasTrackman ? 'bg-amber-100 dark:bg-amber-500/20' : 'bg-red-100 dark:bg-red-500/20'}`}>
                  <Icon name={cancelConfirmModal.hasTrackman ? 'warning' : 'event_busy'} className={`text-3xl ${cancelConfirmModal.hasTrackman ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`} />
                </div>
              </div>
              <h3 className="text-2xl leading-tight font-bold text-center text-primary dark:text-white mb-2" style={{ fontFamily: 'var(--font-headline)' }}>
                Cancel Booking?
              </h3>
              <p className="text-sm text-center text-gray-600 dark:text-gray-300 mb-4">
                Cancel booking for {cancelConfirmModal.booking?.user_name || cancelConfirmModal.booking?.user_email}?
              </p>

              {cancelConfirmModal.hasTrackman && (
                <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-4 mb-4">
                  <div className="flex gap-3">
                    <Icon name="info" className="text-amber-600 dark:text-amber-400 text-xl flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                        This booking is linked to Trackman
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                        After cancelling here, you'll need to also cancel it in Trackman.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setCancelConfirmModal({ isOpen: false, booking: null, hasTrackman: false, isCancelling: false, showSuccess: false })}
                  disabled={cancelConfirmModal.isCancelling}
                  className="flex-1 py-3 px-4 rounded-lg border border-gray-200 dark:border-white/25 text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50"
                >
                  Keep Booking
                </button>
                <button
                  onClick={performCancellation}
                  disabled={cancelConfirmModal.isCancelling}
                  className="flex-1 py-3 px-4 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {cancelConfirmModal.isCancelling ? (
                    <Icon name="progress_activity" className="text-sm animate-spin" />
                  ) : (
                    <Icon name="check" className="text-sm" />
                  )}
                  {cancelConfirmModal.isCancelling ? 'Cancelling...' : 'Yes, Cancel'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center mb-4">
                <div className="w-16 h-16 rounded-full flex items-center justify-center bg-green-100 dark:bg-green-500/20">
                  <Icon name="check_circle" className="text-3xl text-green-600 dark:text-green-400" />
                </div>
              </div>
              <h3 className="text-2xl leading-tight font-bold text-center text-primary dark:text-white mb-2" style={{ fontFamily: 'var(--font-headline)' }}>
                Booking Cancelled
              </h3>
              <p className="text-sm text-center text-gray-600 dark:text-gray-300 mb-4">
                The booking has been cancelled in the app.
              </p>

              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-4 mb-4">
                <div className="flex gap-3">
                  <Icon name="task_alt" className="text-amber-600 dark:text-amber-400 text-xl flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Action Required: Cancel in Trackman
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                      Please also cancel this booking in the Trackman system to keep both systems in sync.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setCancelConfirmModal({ isOpen: false, booking: null, hasTrackman: false, isCancelling: false, showSuccess: false })}
                  className="flex-1 py-3 px-4 rounded-lg border border-gray-200 dark:border-white/25 text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-white/5"
                >
                  Done
                </button>
                <button
                  onClick={() => {
                    window.open('https://booking.indoorgolf.io', '_blank');
                    setCancelConfirmModal({ isOpen: false, booking: null, hasTrackman: false, isCancelling: false, showSuccess: false });
                  }}
                  className="flex-1 py-3 px-4 rounded-lg bg-primary hover:bg-primary/90 text-white font-medium flex items-center justify-center gap-2"
                >
                  <Icon name="open_in_new" className="text-sm" />
                  Open Trackman
                </button>
              </div>
            </>
          )}
        </div>
      </ModalShell>
    </>
  );
};

export default SimulatorModals;
