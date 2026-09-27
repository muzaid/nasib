import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../l10n/strings_ar.dart';

/// The application.
///
/// Not a registration. The user is told on the first screen that not
/// everyone is accepted, which sets the expectation that this app is
/// different and filters out casual traffic before it costs anything.
///
/// Target: 8 to 12 minutes, and the app says so, because an unbounded
/// onboarding flow is where conversion dies.
class ApplicationScreen extends StatefulWidget {
  const ApplicationScreen({super.key});

  @override
  State<ApplicationScreen> createState() => _ApplicationScreenState();
}

class _ApplicationScreenState extends State<ApplicationScreen> {
  final _controller = PageController();
  int _step = 0;

  // Order matters and is not arbitrary: cheap signals first, the liveness
  // selfie last — once the user has invested enough to finish it.
  static final _steps = [
    _StepMeta(Ar.stepBasics, Ar.stepBasicsSub),
    _StepMeta(Ar.stepFamily, Ar.stepFamilySub),
    _StepMeta(Ar.stepReadiness, Ar.stepReadinessSub),
    _StepMeta(Ar.stepAbout, Ar.stepAboutSub),
    _StepMeta(Ar.stepPhotos, Ar.stepPhotosSub),
    _StepMeta(Ar.stepLiveness, Ar.stepLivenessSub),
    _StepMeta(Ar.stepPledge, Ar.stepPledgeSub),
  ];

  void _next() {
    if (_step == _steps.length - 1) {
      Navigator.of(context).pushReplacementNamed('/pending');
      return;
    }
    setState(() => _step++);
    _controller.animateToPage(_step,
        duration: const Duration(milliseconds: 260), curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    final meta = _steps[_step];

    return Scaffold(
      appBar: AppBar(
        title: Text('${_step + 1} ${Ar.stepOf} ${_steps.length}'),
        leading: _step == 0
            ? null
            : IconButton(
                icon: const Icon(Icons.arrow_forward), // RTL: back points right
                onPressed: () {
                  setState(() => _step--);
                  _controller.animateToPage(_step,
                      duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
                },
              ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(3),
          child: LinearProgressIndicator(
            value: (_step + 1) / _steps.length,
            minHeight: 3,
            backgroundColor: NasibTheme.ink.withValues(alpha: 0.06),
          ),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(meta.title, style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 4),
                  Text(meta.subtitle, style: Theme.of(context).textTheme.bodyMedium),
                ],
              ),
            ),
            Expanded(
              child: PageView(
                controller: _controller,
                physics: const NeverScrollableScrollPhysics(),
                children: const [
                  _BasicsStep(),
                  _FamilyStep(),
                  _ReadinessStep(),
                  _AboutYouStep(),
                  _PhotosStep(),
                  _LivenessIntroStep(),
                  _PledgeStep(),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
              child: FilledButton(
                onPressed: _next,
                child: Text(_step == _steps.length - 1 ? Ar.submitApplication : Ar.next),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StepMeta {
  const _StepMeta(this.title, this.subtitle);
  final String title;
  final String subtitle;
}

// --------------------------------------------------------------------- //

class _BasicsStep extends StatelessWidget {
  const _BasicsStep();

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(20),
        children: const [
          _Field(label: Ar.fieldName, hint: Ar.fieldNameHint),
          _Field(label: Ar.fieldBirth, hint: 'يوم / شهر / سنة'),
          _Field(label: Ar.fieldCity, hint: Ar.fieldCityHint),
          _Field(label: Ar.fieldEducation, hint: Ar.optional),
          _Field(label: Ar.fieldWork, hint: Ar.optional),
        ],
      );
}

class _FamilyStep extends StatelessWidget {
  const _FamilyStep();

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(20),
        children: const [
          _Choice(
            label: Ar.maritalStatus,
            options: [Ar.maritalNever, Ar.maritalDivorced, Ar.maritalWidowed],
          ),
          _Choice(label: Ar.childrenCount, options: [Ar.childrenNone, '1', '2', '3 أو أكثر']),
          _Choice(
            label: Ar.practice,
            options: [
              Ar.practicePracticing,
              Ar.practiceModerate,
              Ar.practiceCultural,
              Ar.practicePreferNot,
            ],
          ),
        ],
      );
}

class _ReadinessStep extends StatelessWidget {
  const _ReadinessStep();

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(20),
        children: const [
          // These are the fields that save serious people the most time,
          // and they are exactly what a family asks first.
          _Choice(
            label: Ar.timeline,
            options: [
              Ar.timelineSixMonths,
              Ar.timelineYear,
              Ar.timelineTwoYears,
              Ar.timelineRightPerson,
            ],
          ),
          _Choice(label: Ar.livingAfter,
              options: [Ar.livingOwn, Ar.livingFamily, Ar.livingUndecided]),
          _Choice(label: Ar.relocate, options: [Ar.yes, Ar.no, Ar.relocateMaybe]),
          _Choice(label: Ar.familyAware, options: [Ar.yes, Ar.familyNotYet]),
        ],
      );
}

class _AboutYouStep extends StatelessWidget {
  const _AboutYouStep();

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const _Field(
            label: Ar.aboutYou,
            hint: Ar.aboutYouHint,
            maxLines: 7,
          ),
          const SizedBox(height: 8),
          // No mention of English: there is none in this product.
          Text(Ar.aboutYouNote, style: Theme.of(context).textTheme.bodyMedium),
        ],
      );
}

class _PhotosStep extends StatelessWidget {
  const _PhotosStep();

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            children: List.generate(
              6,
              (i) => DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: NasibTheme.ink.withValues(alpha: 0.10)),
                ),
                child: const Icon(Icons.add_a_photo_outlined, color: NasibTheme.muted),
              ),
            ),
          ),
          const SizedBox(height: 24),
          // There is no visibility setting to offer. Every photo is blurred
          // for everyone, and the only route past that is this person
          // approving one named request at a time. Offering a choice here
          // would mean a setting exists that makes a face browsable.
          Text(Ar.photosAlwaysBlurred, style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: 12),
          const _Note(Ar.photosHowRevealed),
          const SizedBox(height: 12),
          const _Note(Ar.screenshotWarning),
        ],
      );
}

class _LivenessIntroStep extends StatelessWidget {
  const _LivenessIntroStep();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.face_retouching_natural, size: 56, color: NasibTheme.teal),
            const SizedBox(height: 16),
            Text(Ar.livenessTitle, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            Text(Ar.livenessBody, style: Theme.of(context).textTheme.bodyLarge),
            const SizedBox(height: 20),
            // The camera step itself is a full screen rather than a page in
            // this flow: it needs the whole display, and an instruction
            // competing with a progress bar and a Next button is an
            // instruction people miss.
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).pushNamed('/camera'),
              icon: const Icon(Icons.photo_camera_front_outlined),
              label: const Text(Ar.liveCaptureStart),
            ),
            const Spacer(),
            const _Note(Ar.livenessNote),
          ],
        ),
      );
}

class _PledgeStep extends StatelessWidget {
  const _PledgeStep();

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(20),
        children: const [
          // Not legal theatre. This is the record pointed at when an
          // account is removed, and it measurably suppresses bad-faith
          // signup on its own.
          _Pledge(Ar.pledgeMarriage),
          _Pledge(Ar.pledgeFree),
          _Pledge(Ar.pledgePhotos),
          _Pledge(Ar.pledgeHonest),
        ],
      );
}

// --------------------------------------------------------------------- //

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.hint, this.maxLines = 1});
  final String label;
  final String hint;
  final int maxLines;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            TextField(maxLines: maxLines, decoration: InputDecoration(hintText: hint)),
          ],
        ),
      );
}

class _Choice extends StatefulWidget {
  const _Choice({required this.label, required this.options});
  final String label;
  final List<String> options;

  @override
  State<_Choice> createState() => _ChoiceState();
}

class _ChoiceState extends State<_Choice> {
  int? _selected;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.label, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (var i = 0; i < widget.options.length; i++)
                  ChoiceChip(
                    label: Text(widget.options[i]),
                    selected: _selected == i,
                    onSelected: (_) => setState(() => _selected = i),
                  ),
              ],
            ),
          ],
        ),
      );
}

class _Pledge extends StatefulWidget {
  const _Pledge(this.text);
  final String text;

  @override
  State<_Pledge> createState() => _PledgeState();
}

class _PledgeState extends State<_Pledge> {
  bool _checked = false;

  @override
  Widget build(BuildContext context) => CheckboxListTile(
        value: _checked,
        onChanged: (v) => setState(() => _checked = v ?? false),
        title: Text(widget.text, style: Theme.of(context).textTheme.bodyLarge),
        contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading,
      );
}

class _Note extends StatelessWidget {
  const _Note(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: NasibTheme.teal.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.lock_outline, size: 18, color: NasibTheme.teal),
            const SizedBox(width: 10),
            Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyMedium)),
          ],
        ),
      );
}
