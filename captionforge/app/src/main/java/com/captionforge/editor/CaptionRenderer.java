package com.captionforge.editor;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import java.util.ArrayList;
import java.util.List;

public final class CaptionRenderer {
    private CaptionRenderer() {}

    public static void draw(Canvas canvas, Caption caption, long timeMs, int width, int height, boolean export) {
        if (caption == null || timeMs < caption.startMs || timeMs > caption.endMs || caption.text.trim().isEmpty()) return;
        float local = timeMs - caption.startMs;
        float alpha = 1f, scale = 1f, offsetY = 0f;
        if (caption.animation == 1) alpha = Math.min(1f, local / 260f);
        if (caption.animation == 2) scale = .72f + .28f * Math.min(1f, local / 220f);
        if (caption.animation == 3) { offsetY = (1f - Math.min(1f, local / 300f)) * height * .055f; alpha = Math.min(1f, local / 180f); }
        String source = caption.uppercase ? caption.text.toUpperCase() : caption.text;
        if (caption.animation == 4) {
            int visible = Math.min(source.length(), (int) (local / 42f));
            source = source.substring(0, visible);
            if (source.isEmpty()) return;
        }
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        Typeface base = caption.font == 1 ? Typeface.SERIF : caption.font == 2 ? Typeface.MONOSPACE : Typeface.SANS_SERIF;
        paint.setTypeface(Typeface.create(base, caption.bold ? Typeface.BOLD : Typeface.NORMAL));
        paint.setTextAlign(caption.align == 0 ? Paint.Align.LEFT : caption.align == 2 ? Paint.Align.RIGHT : Paint.Align.CENTER);
        paint.setColor(caption.color);
        paint.setAlpha((int) (255 * alpha));
        paint.setTextSize(caption.size * width / 1080f * scale);
        if (caption.font == 2) paint.setShadowLayer(width * .012f, 0, 0, caption.color);
        float maxWidth = width * .86f;
        List<String> lines = wrap(source, paint, maxWidth);
        Paint.FontMetrics fm = paint.getFontMetrics();
        float lineHeight = (fm.descent - fm.ascent) * 1.18f;
        float textHeight = lines.size() * lineHeight;
        float centerX = caption.x * width;
        float centerY = caption.y * height + offsetY;
        float top = centerY - textHeight / 2f;
        if (caption.background) {
            float widest = 0;
            for (String line : lines) widest = Math.max(widest, paint.measureText(line));
            RectF box = new RectF(centerX - widest / 2f - width * .025f, top + fm.ascent - width * .018f,
                    centerX + widest / 2f + width * .025f, top + textHeight + width * .012f);
            Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
            bg.setColor(caption.backgroundColor);
            bg.setAlpha((int) (Color.alpha(caption.backgroundColor) * alpha));
            canvas.drawRoundRect(box, width * .018f, width * .018f, bg);
        }
        float baseline = top - fm.ascent;
        for (String line : lines) {
            float lineX = caption.align == 0 ? centerX - maxWidth / 2f : caption.align == 2 ? centerX + maxWidth / 2f : centerX;
            canvas.drawText(line, lineX, baseline, paint);
            baseline += lineHeight;
        }
    }

    private static List<String> wrap(String text, Paint paint, float maxWidth) {
        List<String> lines = new ArrayList<>();
        for (String paragraph : text.split("\\n")) {
            String[] words = paragraph.trim().split("\\s+");
            StringBuilder line = new StringBuilder();
            for (String word : words) {
                String candidate = line.length() == 0 ? word : line + " " + word;
                if (line.length() > 0 && paint.measureText(candidate) > maxWidth) {
                    lines.add(line.toString()); line = new StringBuilder(word);
                } else line = new StringBuilder(candidate);
            }
            if (line.length() > 0) lines.add(line.toString());
        }
        return lines;
    }
}
