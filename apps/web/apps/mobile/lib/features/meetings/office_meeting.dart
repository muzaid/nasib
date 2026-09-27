import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../l10n/strings_ar.dart';

/// Office meetings.
///
/// The first meeting happens at one of our offices, in a private room, with
/// a staff member present and family welcome. This is the single feature no
/// competitor has, and it is worth more than any matching improvement: it
/// is what a family will actually agree to, and it removes the most
/// dangerous moment in the whole product — two strangers arranging to meet
/// somewhere private off the back of an app conversation.
///
/// The user never picks a slot themselves. They agree to meet; we find the
/// room. That keeps the office's real schedule private, and it means a
/// human has looked at the pairing before the door opens.

enum MeetingState { none, proposed, invited, scheduling, scheduled, declined }

class MeetingCard extends StatelessWidget {
  const MeetingCard({
    super.key,
    required this.state,
    required this.otherName,
    this.appointment,
    this.onPropose,
    this.onAccept,
    this.onDecline,
    this.onCancel,
  });

  final MeetingState state;
  final String otherName;
  final Appointment? appointment;
  final VoidCallback? onPropose;
  final void Function(bool bringsFamily)? onAccept;
  final VoidCallback? onDecline;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) => switch (state) {
        MeetingState.none => _Invitation(otherName: otherName, onPropose: onPropose),
        MeetingState.proposed => const _Waiting(),
        MeetingState.invited => _Invited(
            otherName: otherName,
            onAccept: onAccept,
            onDecline: onDecline,
          ),
        MeetingState.scheduling => const _Scheduling(),
        MeetingState.scheduled => _Scheduled(appointment: appointment!, onCancel: onCancel),
        MeetingState.declined => const SizedBox.shrink(),
      };
}

class Appointment {
  const Appointment({
    required this.officeName,
    required this.address,
    required this.startsAt,
    required this.room,
    required this.staffName,
    required this.familyAttending,
    this.directions,
  });

  final String officeName;
  final String address;
  final DateTime startsAt;
  final String room;
  final String staffName;
  final bool familyAttending;
  final String? directions;
}

// --------------------------------------------------------------------- //

class _Invitation extends StatelessWidget {
  const _Invitation({required this.otherName, this.onPropose});
  final String otherName;
  final VoidCallback? onPropose;

  @override
  Widget build(BuildContext context) => _Panel(
        icon: Icons.meeting_room_outlined,
        title: Ar.officeMeeting,
        children: [
          Text(Ar.meetingExplainer, style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: 10),
          Text(Ar.meetingWhyHere, style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 16),
          FilledButton(onPressed: onPropose, child: const Text(Ar.proposeMeeting)),
        ],
      );
}

class _Waiting extends StatelessWidget {
  const _Waiting();

  @override
  Widget build(BuildContext context) => _Panel(
        icon: Icons.schedule_outlined,
        title: Ar.meetingProposed,
        children: [
          Text(Ar.meetingAwaitingOther, style: Theme.of(context).textTheme.bodyLarge),
        ],
      );
}

class _Invited extends StatefulWidget {
  const _Invited({required this.otherName, this.onAccept, this.onDecline});
  final String otherName;
  final void Function(bool)? onAccept;
  final VoidCallback? onDecline;

  @override
  State<_Invited> createState() => _InvitedState();
}

class _InvitedState extends State<_Invited> {
  bool _bringsFamily = false;

  @override
  Widget build(BuildContext context) => _Panel(
        icon: Icons.meeting_room_outlined,
        title: Ar.meetingInvited,
        children: [
          Text(Ar.meetingExplainer, style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: 12),
          // Asked explicitly, because the answer changes how the room is
          // set up and how many chairs are in it.
          CheckboxListTile(
            value: _bringsFamily,
            onChanged: (v) => setState(() => _bringsFamily = v ?? false),
            title: const Text(Ar.bringFamily),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: widget.onDecline,
                  child: const Text(Ar.declineMeeting),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: FilledButton(
                  onPressed: () => widget.onAccept?.call(_bringsFamily),
                  child: const Text(Ar.acceptMeeting),
                ),
              ),
            ],
          ),
        ],
      );
}

class _Scheduling extends StatelessWidget {
  const _Scheduling();

  @override
  Widget build(BuildContext context) => _Panel(
        icon: Icons.event_available_outlined,
        title: Ar.meetingScheduling,
        children: [
          Text(Ar.meetingSchedulingBody, style: Theme.of(context).textTheme.bodyLarge),
        ],
      );
}

class _Scheduled extends StatelessWidget {
  const _Scheduled({required this.appointment, this.onCancel});
  final Appointment appointment;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    return _Panel(
      icon: Icons.event_available_rounded,
      title: Ar.meetingScheduled,
      accent: NasibTheme.verified,
      children: [
        _Row(Ar.meetingWhen, _arabicDateTime(a.startsAt)),
        _Row(Ar.meetingOffice, a.officeName),
        _Row(Ar.meetingDirections, a.address),
        _Row(Ar.meetingRoom, a.room),
        _Row(Ar.meetingStaff, a.staffName),
        if (a.familyAttending) _Row(Ar.bringFamily, Ar.yes),

        const SizedBox(height: 16),
        Text(Ar.meetingBeforeYouCome, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        const _Check(Ar.meetingChecklist1),
        const _Check(Ar.meetingChecklist2),
        const _Check(Ar.meetingChecklist3),

        const SizedBox(height: 14),
        Text(Ar.meetingNoShowNote, style: Theme.of(context).textTheme.bodyMedium),

        const SizedBox(height: 10),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(
            onPressed: onCancel,
            style: TextButton.styleFrom(foregroundColor: NasibTheme.danger),
            child: const Text(Ar.meetingCancel),
          ),
        ),
      ],
    );
  }

  static const _months = [
    'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
    'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
  ];

  static const _days = [
    'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد',
  ];

  /// Levantine month names, not the transliterated Gregorian ones. A date
  /// written "يناير" in Ramallah reads as foreign.
  static String _arabicDateTime(DateTime d) {
    final day = _days[d.weekday - 1];
    final hour12 = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final period = d.hour < 12 ? 'صباحاً' : 'مساءً';
    final minute = d.minute.toString().padLeft(2, '0');
    return '$day ${d.day} ${_months[d.month - 1]} · $hour12:$minute $period';
  }
}

// --------------------------------------------------------------------- //

class _Panel extends StatelessWidget {
  const _Panel({
    required this.icon,
    required this.title,
    required this.children,
    this.accent = NasibTheme.teal,
  });

  final IconData icon;
  final String title;
  final List<Widget> children;
  final Color accent;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: NasibTheme.ink.withValues(alpha: 0.08)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 20, color: accent),
                const SizedBox(width: 10),
                Text(title, style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 14),
            ...children,
          ],
        ),
      );
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 104,
              child: Text(label, style: Theme.of(context).textTheme.bodyMedium),
            ),
            Expanded(
              child: Text(value,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        fontWeight: FontWeight.w600,
                      )),
            ),
          ],
        ),
      );
}

class _Check extends StatelessWidget {
  const _Check(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.circle, size: 6, color: NasibTheme.muted),
            const SizedBox(width: 10),
            Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyLarge)),
          ],
        ),
      );
}
