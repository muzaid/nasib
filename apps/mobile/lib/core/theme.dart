import 'dart:math' as math;

import 'package:flutter/material.dart';

/// The design system.
///
/// Two priorities, in this order: legibility, then character. Arabic loses
/// more to low contrast and tight leading than Latin does, so the palette
/// is built on white and a deep navy ink — about 14:1 — rather than on a
/// warm ground that reads pleasant and costs a third of the contrast.
///
/// Three rules hold it together:
///   * Two colours only. Navy is ink and structure; teal is anything you
///     can press. A third accent would mean nothing and add noise.
///   * White panels on a faintly tinted page, separated by a hairline.
///     No heavy borders, no stacked shadows.
///   * One ornament, the eight-point star, used two or three times in the
///     whole app. Islamic geometry is easy to overdo into wallpaper.
class NasibTheme {
  // ---- grounds ------------------------------------------------------ //
  static const page = Color(0xFFF6F9FB);
  static const panel = Color(0xFFFFFFFF);
  static const panelAlt = Color(0xFFEFF4F8);
  static const line = Color(0xFFDDE5EB);

  // ---- ink ---------------------------------------------------------- //
  static const ink = Color(0xFF0F2033);     // deep navy
  static const inkSoft = Color(0xFF44586B);
  static const muted = Color(0xFF7C8FA0);

  // ---- colour ------------------------------------------------------- //
  /// The one action colour. If it is on screen, it can be pressed.
  static const teal = Color(0xFF0E7C7B);
  static const tealDeep = Color(0xFF0A5F5E);
  static const tealSoft = Color(0xFFE2F1F1);

  /// Structure and marks — the star, a section rule, a secondary panel
  /// edge. Never a button.
  static const accent = Color(0xFF14527A);
  static const accentSoft = Color(0xFFE6EFF6);

  static const verified = Color(0xFF0F7A57);
  static const caution = Color(0xFFA85C00);
  static const danger = Color(0xFFB3261E);

  /// Cairo, at four weights. One family for everything: a display serif
  /// looked handsome and cost clarity, and clarity is what this audience
  /// actually needs — the wordmark is Cairo Bold at 40px and holds up fine.
  static const fontFamily = 'Cairo';

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: teal,
      brightness: Brightness.light,
    ).copyWith(
      surface: page,
      primary: teal,
      secondary: accent,
      outline: line,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: page,
      fontFamily: fontFamily,
      splashFactory: InkSparkle.splashFactory,

      appBarTheme: const AppBarTheme(
        backgroundColor: page,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: true,
        titleTextStyle: TextStyle(
          fontFamily: fontFamily,
          fontSize: 17.5,
          fontWeight: FontWeight.w700,
          color: ink,
        ),
        iconTheme: IconThemeData(color: ink, size: 22),
      ),

      // No cardTheme here on purpose. Flutter changed its type from
      // CardTheme to CardThemeData between releases, so a theme that sets
      // it compiles on one SDK and fails on the next — for a widget this
      // app uses once. The surface is [Panel] instead.

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: teal,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(54),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(
            fontFamily: fontFamily, fontSize: 16.5, fontWeight: FontWeight.w700,
          ),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ink,
          minimumSize: const Size.fromHeight(54),
          side: const BorderSide(color: line, width: 1.2),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(
            fontFamily: fontFamily, fontSize: 16, fontWeight: FontWeight.w600,
          ),
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: teal,
          textStyle: const TextStyle(
            fontFamily: fontFamily, fontSize: 15, fontWeight: FontWeight.w600,
          ),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: panel,
        hintStyle: const TextStyle(color: muted, fontSize: 15.5),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: teal, width: 1.8),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: panel,
        selectedColor: tealSoft,
        side: const BorderSide(color: line),
        labelStyle: const TextStyle(
          fontFamily: fontFamily, fontSize: 14.5, fontWeight: FontWeight.w500, color: ink,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
      ),

      dividerTheme: const DividerThemeData(color: line, thickness: 1, space: 1),

      // Cairo carries more ink per glyph than a Latin sans at the same
      // size, so it wants a larger base size AND more leading, not less.
      // Setting Arabic tight is the fastest way to make a screen look
      // dumped rather than designed.
      textTheme: const TextTheme(
        displaySmall: TextStyle(
          fontFamily: fontFamily, fontSize: 40, fontWeight: FontWeight.w700,
          height: 1.4, letterSpacing: -0.4, color: ink,
        ),
        headlineSmall: TextStyle(
          fontFamily: fontFamily, fontSize: 25, fontWeight: FontWeight.w700,
          height: 1.45, color: ink,
        ),
        titleMedium: TextStyle(
          fontFamily: fontFamily, fontSize: 17, fontWeight: FontWeight.w600,
          height: 1.55, color: ink,
        ),
        bodyLarge: TextStyle(fontFamily: fontFamily, fontSize: 16.5, height: 1.95, color: ink),
        bodyMedium: TextStyle(fontFamily: fontFamily, fontSize: 14, height: 1.8, color: inkSoft),
        labelSmall: TextStyle(
          fontFamily: fontFamily, fontSize: 12.5, fontWeight: FontWeight.w700, color: inkSoft,
        ),
      ),
    );
  }
}

// ===================================================================== //
// The ornament
// ===================================================================== //

/// An eight-point star (نجمة ثمانية), the most common motif in Levantine
/// tilework and woodwork. Drawn rather than shipped as an asset so it
/// takes the theme's colour and any size.
///
/// Used three times in the whole app: the welcome hero, the divider above
/// a section heading, and the confirmation of an office appointment. Any
/// more and it becomes wallpaper.
class StarMark extends StatelessWidget {
  const StarMark({super.key, this.size = 18, this.color = NasibTheme.teal, this.filled = false});

  final double size;
  final Color color;
  final bool filled;

  @override
  Widget build(BuildContext context) => CustomPaint(
        size: Size.square(size),
        painter: _StarPainter(color: color, filled: filled),
      );
}

class _StarPainter extends CustomPainter {
  _StarPainter({required this.color, required this.filled});

  final Color color;
  final bool filled;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final r = size.width / 2;
    final path = Path();

    // Two overlaid squares, one rotated 45° — which is how the motif is
    // actually constructed in tile, rather than a star drawn point by point.
    for (var i = 0; i < 16; i++) {
      final radius = i.isEven ? r : r * 0.54;
      final angle = (math.pi / 8) * i - math.pi / 2;
      final p = c + Offset(math.cos(angle) * radius, math.sin(angle) * radius);
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    path.close();

    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..style = filled ? PaintingStyle.fill : PaintingStyle.stroke
        ..strokeWidth = size.width * 0.055
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_StarPainter old) => old.color != color || old.filled != filled;
}

/// A hairline with the star centred in it. The one divider the app uses
/// above a major section.
class OrnamentDivider extends StatelessWidget {
  const OrnamentDivider({super.key, this.width = 120});

  final double width;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: width,
        child: const Row(
          children: [
            Expanded(child: Divider(color: NasibTheme.accentSoft)),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 10),
              child: StarMark(size: 13),
            ),
            Expanded(child: Divider(color: NasibTheme.accentSoft)),
          ],
        ),
      );
}

// ===================================================================== //
// Verification badge
// ===================================================================== //

/// Three states, no number. A numeric trust score shown in-product becomes
/// a ranking people optimise for, and turns verification from a safety
/// feature into a status game.
enum VerificationBadge { unverified, photoVerified, idVerified }

class BadgeChip extends StatelessWidget {
  const BadgeChip(this.badge, {super.key});

  final VerificationBadge badge;

  @override
  Widget build(BuildContext context) {
    final (label, icon, colour, tinted) = switch (badge) {
      VerificationBadge.idVerified =>
        ('هوية موثّقة', Icons.verified_rounded, NasibTheme.accent, NasibTheme.accentSoft),
      VerificationBadge.photoVerified =>
        ('صورة موثّقة', Icons.check_rounded, NasibTheme.teal, NasibTheme.tealSoft),
      VerificationBadge.unverified =>
        ('غير موثّق', Icons.remove_rounded, NasibTheme.muted, NasibTheme.panelAlt),
    };

    return Container(
      padding: const EdgeInsetsDirectional.fromSTEB(10, 5, 11, 5),
      decoration: BoxDecoration(
        color: tinted,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: colour.withValues(alpha: 0.28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: colour),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontFamily: NasibTheme.fontFamily,
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: colour,
            ),
          ),
        ],
      ),
    );
  }
}

// ===================================================================== //
// Surfaces
// ===================================================================== //

/// The app's one card. White on a faintly tinted page, a hairline edge, and
/// a shadow so light it reads as lift rather than as a box.
class Panel extends StatelessWidget {
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.tint,
    this.accent,
  });

  final Widget child;
  final EdgeInsets padding;
  final Color? tint;

  /// A 3px bar along the leading edge, for a panel that carries a state.
  /// Spent sparingly — a bar on every panel flattens the hierarchy.
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    final BoxBorder border = accent == null
        ? Border.all(color: NasibTheme.line)
        : BorderDirectional(
            start: BorderSide(color: accent!, width: 3),
            top: const BorderSide(color: NasibTheme.line),
            bottom: const BorderSide(color: NasibTheme.line),
            end: const BorderSide(color: NasibTheme.line),
          );

    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: tint ?? NasibTheme.panel,
        borderRadius: BorderRadius.circular(20),
        border: border,
        boxShadow: const [
          BoxShadow(color: Color(0x0D0F2033), blurRadius: 18, offset: Offset(0, 6)),
        ],
      ),
      child: child,
    );
  }
}

/// Section label: a short teal rule and a bold caption above a group.
class Eyebrow extends StatelessWidget {
  const Eyebrow(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          children: [
            Container(width: 14, height: 2, color: NasibTheme.teal),
            const SizedBox(width: 8),
            Text(text, style: Theme.of(context).textTheme.labelSmall),
          ],
        ),
      );
}
