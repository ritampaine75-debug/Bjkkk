package com.captionforge.editor;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.MotionEvent;
import android.view.View;
import java.util.List;

public class CaptionOverlayView extends View {
    private List<Caption> captions;
    private int selected = -1;
    private long timeMs = 0;
    private float downX, downY;
    private boolean moved;
    private Runnable changeListener;

    public CaptionOverlayView(Context context) { super(context); }
    public void setCaptions(List<Caption> captions, int selected) { this.captions = captions; this.selected = selected; invalidate(); }
    public void setTimeMs(long timeMs) { this.timeMs = timeMs; invalidate(); }
    public void setChangeListener(Runnable listener) { this.changeListener = listener; }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (captions == null) return;
        for (Caption c : captions) CaptionRenderer.draw(canvas, c, timeMs, getWidth(), getHeight(), false);
        if (selected >= 0 && selected < captions.size()) {
            Caption c = captions.get(selected);
            if (timeMs >= c.startMs && timeMs <= c.endMs) {
                Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
                p.setColor(Color.parseColor("#B8F35A")); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(3);
                float x = c.x * getWidth(), y = c.y * getHeight();
                canvas.drawCircle(x, y, 9, p);
                canvas.drawLine(x - 16, y, x + 16, y, p); canvas.drawLine(x, y - 16, x, y + 16, p);
            }
        }
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (captions == null || selected < 0 || selected >= captions.size()) return false;
        Caption c = captions.get(selected);
        if (event.getAction() == MotionEvent.ACTION_DOWN) {
            downX = event.getX(); downY = event.getY(); moved = false; getParent().requestDisallowInterceptTouchEvent(true); return true;
        }
        if (event.getAction() == MotionEvent.ACTION_MOVE) {
            c.x = clamp(event.getX() / getWidth(), .08f, .92f);
            c.y = clamp(event.getY() / getHeight(), .06f, .94f);
            moved = true; invalidate(); return true;
        }
        if (event.getAction() == MotionEvent.ACTION_UP && moved && changeListener != null) changeListener.run();
        return true;
    }
    private static float clamp(float v, float min, float max) { return Math.max(min, Math.min(max, v)); }
}
