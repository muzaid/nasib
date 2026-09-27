import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:nasib/core/verification_api.dart';
import 'package:nasib/l10n/strings_ar.dart';
import 'package:nasib/main.dart';

/// A smoke test, and the reason this file is in the repository rather than
/// left to `flutter create`: the generated one refers to a `MyApp` that does
/// not exist here, which is a red analyzer error on every clean build.
void main() {
  testWidgets('the app starts, in Arabic, right-to-left', (tester) async {
    await tester.pumpWidget(NasibApp(api: DemoVerificationApi()));
    await tester.pumpAndSettle();

    expect(find.text(Ar.appName), findsWidgets);

    // The camera step is the first thing offered in the demo build.
    expect(find.text(Ar.liveCaptureTitle), findsWidgets);

    // One locale, no fallback: if this ever reads ltr, something has
    // quietly added an English locale to the app.
    final context = tester.element(find.text(Ar.appName).first);
    expect(Directionality.of(context), TextDirection.rtl);
  });
}
