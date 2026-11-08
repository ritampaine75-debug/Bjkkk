package com.captionforge.editor;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.BitmapOverlay;
import androidx.media3.effect.OverlaySettings;
import java.util.List;

@OptIn(markerClass = UnstableApi.class)
public class ExportOverlay extends BitmapOverlay {
    private final Bitmap bitmap;
    private final Canvas canvas;
    private final List<Caption> captions;

    public ExportOverlay(int width, int height, List<Caption> captions) {
        bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        canvas = new Canvas(bitmap);
        this.captions = captions;
    }

    @Override public Bitmap getBitmap(long presentationTimeUs) {
        bitmap.eraseColor(android.graphics.Color.TRANSPARENT);
        long timeMs = presentationTimeUs / 1000;
        for (Caption c : captions) CaptionRenderer.draw(canvas, c, timeMs, bitmap.getWidth(), bitmap.getHeight(), true);
        return bitmap;
    }

    @Override public OverlaySettings getOverlaySettings(long presentationTimeUs) {
        return new OverlaySettings.Builder().build();
    }
}
