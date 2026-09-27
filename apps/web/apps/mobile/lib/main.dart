import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/models.dart';
import 'core/theme.dart';
import 'core/verification_api.dart';
import 'demo/demo_home.dart';
import 'features/discovery/daily_candidates_screen.dart';
import 'features/onboarding/application_screen.dart';
import 'features/verification/live_capture_screen.dart';
import 'features/verification/pending_review_screen.dart';
import 'l10n/strings_ar.dart';

/// Demo mode: no Supabase project, no verification service, fixed data, and
/// a home screen that lists every screen so a build on a phone can be
/// walked through. On by default so that `flutter run` works from a clean
/// checkout; turn it off with
///
///   flutter run --dart-define=NASIB_DEMO=false \
///               --dart-define=NASIB_VERIFY_URL=https://…
///
/// The camera step is real in both modes. What demo mode cannot do is
/// compare that face to an ID — matching is server work, deliberately, and
/// this switch does not fake it.
const bool kDemoMode = bool.fromEnvironment('NASIB_DEMO', defaultValue: true);
const String kVerifyUrl = String.fromEnvironment('NASIB_VERIFY_URL');
const String kVerifyToken = String.fromEnvironment('NASIB_VERIFY_TOKEN');

VerificationApi buildVerificationApi() {
  if (kDemoMode || kVerifyUrl.isEmpty) return DemoVerificationApi();
  return HttpVerificationApi(
    baseUrl: kVerifyUrl,
    serviceToken: kVerifyToken,
    userId: 'me',
  );
}

void main() {
  // In production: await Supabase.initialize(...) before runApp.
  runApp(NasibApp(api: buildVerificationApi()));
}

class NasibApp extends StatelessWidget {
  const NasibApp({super.key, required this.api});

  final VerificationApi api;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: Ar.appName,
      debugShowCheckedModeBanner: false,
      theme: NasibTheme.light(),

      // One language. There is no English locale to fall back to, and that
      // is deliberate: a fallback is how an app ends up half translated,
      // with a stray English button in the middle of an Arabic screen. The
      // copy is written in Arabic, not translated into it, and every string
      // lives in Ar.
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],

      initialRoute: '/',
      routes: {
        '/': (_) => kDemoMode ? DemoHome(api: api) : const _Gate(),
        '/apply': (_) => const ApplicationScreen(),
        '/camera': (_) => LiveCaptureScreen(api: api),
        '/pending': (_) => const PendingReviewScreen(status: AccountStatus.pendingReview),
      },
    );
  }
}

/// Routes by account status.
///
/// An applicant never reaches the discovery screens, and an admitted user
/// never sees the application again. The gate is the single place that
/// decides, so there is no path around it.
class _Gate extends StatelessWidget {
  const _Gate();

  @override
  Widget build(BuildContext context) {
    // Replace with a stream of the signed-in user's status.
    const status = AccountStatus.applying;

    return switch (status) {
      AccountStatus.applying => const WelcomeScreen(),
      AccountStatus.pendingReview || AccountStatus.rejected =>
        const PendingReviewScreen(status: status),
      AccountStatus.admitted => const DailyCandidatesScreen(candidates: []),
      _ => const WelcomeScreen(),
    };
  }
}

/// The first screen.
///
/// It has one job beyond looking like something you would trust: to say,
/// before anyone invests ten minutes, that this is an application and not
/// everyone gets in. That single sentence sets the expectation the whole
/// product depends on, and it filters out casual traffic before it costs
/// anything.
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: DecoratedBox(
        // A single wash from white at the top into the page tint, so the
        // hero sits in light and the promises sit on panels below it. No
        // gradient anywhere else in the app.
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            stops: [0.0, 0.55],
            colors: [Color(0xFFFFFFFF), NasibTheme.page],
          ),
        ),
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(26, 28, 26, 28),
            children: [
              const SizedBox(height: 18),
              const Center(child: StarMark(size: 30)),
              const SizedBox(height: 22),

              // Amiri, at the one size where a naskh serif is genuinely
              // better than a sans: large, centred, few words.
              Center(
                child: Text(
                  Ar.appName,
                  style: Theme.of(context).textTheme.displaySmall,
                ),
              ),
              const SizedBox(height: 6),
              Center(
                child: Text(
                  Ar.tagline,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: NasibTheme.inkSoft,
                        fontSize: 17,
                      ),
                ),
              ),

              const SizedBox(height: 26),
              const Center(child: OrnamentDivider()),
              const SizedBox(height: 26),

              Text(
                Ar.welcomeBody,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge,
              ),

              const SizedBox(height: 28),
              const Panel(
                padding: EdgeInsets.fromLTRB(18, 6, 18, 6),
                child: Column(
                  children: [
                    _Promise(Icons.face_retouching_natural_outlined, Ar.pointLiveness),
                    _Promise(Icons.how_to_reg_outlined, Ar.pointReview),
                    _Promise(Icons.blur_on_rounded, Ar.pointPhotos),
                    _Promise(Icons.meeting_room_outlined, Ar.pointOffice),
                    _Promise(Icons.family_restroom_outlined, Ar.pointWali, last: true),
                  ],
                ),
              ),

              const SizedBox(height: 28),
              FilledButton(
                onPressed: () => Navigator.of(context).pushNamed('/apply'),
                child: const Text(Ar.start),
              ),
              const SizedBox(height: 12),
              Center(
                child: Text(Ar.takesMinutes, style: Theme.of(context).textTheme.bodyMedium),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One promise, with a hairline under it. Hairlines rather than separate
/// cards: five cards in a column would read as five unrelated things.
class _Promise extends StatelessWidget {
  const _Promise(this.icon, this.text, {this.last = false});

  final IconData icon;
  final String text;
  final bool last;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 14),
            child: Row(
              children: [
                Icon(icon, size: 21, color: NasibTheme.teal),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(text, style: Theme.of(context).textTheme.bodyLarge),
                ),
              ],
            ),
          ),
          if (!last) const Divider(height: 1),
        ],
      );
}
