/**
 * Notification service for escalated disputes and critical governance events.
 * Supports webhook (primary) and email via Resend (optional).
 */

export interface EscalationPayload {
  disputeId: string;
  taskId: string;
  amount: string;
  reason: string;
  raisedBy: string;
  against: string | null;
}

/**
 * Send escalation notification via configured channels.
 * Fails silently — escalation persistence is handled by the caller.
 */
export async function sendEscalationNotification(payload: EscalationPayload): Promise<void> {
  const webhookUrl = process.env.ESCALATION_WEBHOOK_URL;
  const email = process.env.ESCALATION_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;

  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event: 'dispute.escalated',
          ...payload,
          timestamp: new Date().toISOString(),
        }),
      });
      console.log(`[NOTIFY] Escalation webhook sent for dispute ${payload.disputeId}`);
    } catch (err) {
      console.error('[NOTIFY] Escalation webhook failed:', err);
    }
  }

  if (email && resendKey) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: 'SwarmDock <noreply@swarmdock.ai>',
          to: email,
          subject: `[SwarmDock] Dispute escalated — $${(parseInt(payload.amount) / 1_000_000).toFixed(2)} USDC`,
          text: [
            `Dispute ${payload.disputeId} has been escalated for manual review.`,
            '',
            `Task: ${payload.taskId}`,
            `Amount: $${(parseInt(payload.amount) / 1_000_000).toFixed(2)} USDC`,
            `Reason: ${payload.reason}`,
            `Raised by: ${payload.raisedBy}`,
            `Against: ${payload.against ?? 'N/A'}`,
            '',
            'Review at: https://swarmdock-api.onrender.com/api/v1/admin/disputes',
          ].join('\n'),
        }),
      });
      console.log(`[NOTIFY] Escalation email sent for dispute ${payload.disputeId}`);
    } catch (err) {
      console.error('[NOTIFY] Escalation email failed:', err);
    }
  }

  if (!webhookUrl && !(email && resendKey)) {
    console.warn(`[NOTIFY] No escalation channels configured for dispute ${payload.disputeId}`);
  }
}
