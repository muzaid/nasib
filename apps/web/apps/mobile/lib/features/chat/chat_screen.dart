import 'package:flutter/foundation.dart' show setEquals;
import 'package:flutter/material.dart';

import '../../core/guarded_text.dart';
import '../../core/models.dart';
import '../../core/protected_screen.dart';
import '../../core/theme.dart';

/// Guarded conversation.
///
/// Three rules are enforced here and again on the server:
///   * contact details are stripped until the in-app video call has happened
///   * a chaperoned or gated wali is visible to both sides, always
///   * money is never discussed — any financial request is flagged and the
///     recipient sees an inline warning
///
/// The composer warns *before* sending rather than mangling the message
/// afterwards, because silently altering someone's words is worse than
/// telling them why they cannot send them.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.match, required this.messages, required this.myId});

  final Match match;
  final List<Message> messages;
  final String myId;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _composer = TextEditingController();

  /// What the draft would lose if it were sent now. Empty means nothing.
  Set<PersonalDataKind> _wouldRemove = const {};

  bool get _wouldRedact => _wouldRemove.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _composer.addListener(() {
      final found = widget.match.contactUnlocked
          ? ContactGuard.apply(_composer.text, unlocked: true).found
          : ContactGuard.wouldRemove(_composer.text);
      // setState only when the set changes, not on every keystroke: this
      // listener runs per character typed.
      if (!setEquals(found, _wouldRemove)) {
        setState(() => _wouldRemove = found);
      }
    });
  }

  @override
  void dispose() {
    _composer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // A conversation is as private as the photos are: it carries names,
    // families, and what someone is willing to say when they think only
    // one person is reading.
    return ProtectedScreen(
      child: Scaffold(
      appBar: AppBar(
        title: Column(
          children: [
            Text(widget.match.other.displayName),
            if (widget.match.waliPresent)
              Text('الوليّ يطّلع على المحادثة',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontSize: 11.5)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.shield_outlined),
            tooltip: 'الأمان',
            onPressed: () => _showSafetySheet(context),
          ),
        ],
      ),
      body: Column(
        children: [
          if (!widget.match.videoCallDone) const _VideoCallGate(),
          Expanded(
            child: ListView.builder(
              reverse: true,
              padding: const EdgeInsets.all(16),
              itemCount: widget.messages.length,
              itemBuilder: (context, i) {
                final m = widget.messages[widget.messages.length - 1 - i];
                return _Bubble(message: m, mine: m.senderId == widget.myId);
              },
            ),
          ),
          if (_wouldRedact) _RedactionWarning(found: _wouldRemove),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _composer,
                      maxLines: 4,
                      minLines: 1,
                      decoration: const InputDecoration(hintText: 'اكتب رسالة'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _wouldRedact ? null : () {},
                    icon: const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      ),
    );
  }

  void _showSafetySheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.flag_outlined),
              title: const Text('الإبلاغ عن هذا الشخص'),
              // "This person is married" and "asked me for money" are
              // first-class options, not buried under "other". They are
              // the two complaints that define this product's reputation.
              subtitle: const Text('متزوج · طلب مالاً · مضايقة · ملف مزيّف'),
              onTap: () {},
            ),
            ListTile(
              leading: const Icon(Icons.block),
              title: const Text('حظر وإنهاء التوافق'),
              onTap: () {},
            ),
            ListTile(
              leading: const Icon(Icons.share_location_outlined),
              title: const Text('مشاركة موعد اللقاء مع شخص تثق به'),
              subtitle: const Text('قبل أول لقاء'),
              onTap: () {},
            ),
          ],
        ),
      ),
    );
  }
}

class _VideoCallGate extends StatelessWidget {
  const _VideoCallGate();

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        color: NasibTheme.teal.withValues(alpha: 0.07),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Row(
          children: [
            const Icon(Icons.videocam_outlined, size: 20, color: NasibTheme.teal),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'مكالمة مرئية داخل التطبيق قبل تبادل أي وسيلة تواصل.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
            TextButton(onPressed: () {}, child: const Text('ابدأ')),
          ],
        ),
      );
}

/// Names what was found, rather than just refusing.
///
/// "This message contains an address" is something the sender can act on.
/// "Your message was blocked" is a dead end, and it reads as a fault in
/// the app rather than a rule with a reason.
class _RedactionWarning extends StatelessWidget {
  const _RedactionWarning({required this.found});

  final Set<PersonalDataKind> found;

  String get _what => found.map((k) => k.label).join(' و');

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        color: NasibTheme.caution.withValues(alpha: 0.10),
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: Row(
          children: [
            const Icon(Icons.info_outline, size: 18, color: NasibTheme.caution),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'رسالتك تحتوي على $_what.',
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    found.contains(PersonalDataKind.identifier)
                        ? 'أرقام الهوية والحسابات البنكية لا تُرسل هنا في أي مرحلة.'
                        : 'لا تُرسل بيانات شخصية قبل المكالمة المرئية. '
                            'معظم عمليات النصب تبدأ بالانتقال إلى تطبيق آخر.',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
          ],
        ),
      );
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, required this.mine});

  final Message message;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: mine ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.75),
        decoration: BoxDecoration(
          color: mine ? NasibTheme.teal : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: mine ? null : Border.all(color: NasibTheme.ink.withValues(alpha: 0.08)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              message.body,
              style: TextStyle(
                fontSize: 15.5,
                height: 1.6,
                color: mine ? Colors.white : NasibTheme.ink,
              ),
            ),
            if (message.redacted) ...[
              const SizedBox(height: 6),
              Text(
                'حُذفت وسيلة تواصل من هذه الرسالة',
                style: TextStyle(
                  fontSize: 11.5,
                  color: mine ? Colors.white70 : NasibTheme.caution,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
