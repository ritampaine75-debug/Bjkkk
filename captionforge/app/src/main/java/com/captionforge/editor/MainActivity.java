package com.captionforge.editor;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.VideoView;
import androidx.annotation.OptIn;
import androidx.media3.common.Effect;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.OverlayEffect;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import com.google.common.collect.ImmutableList;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

@OptIn(markerClass = UnstableApi.class)
public class MainActivity extends Activity {
    private static final int PICK_VIDEO = 41, CREATE_VIDEO = 42;
    private static final int BG = Color.parseColor("#0B0D12"), PANEL = Color.parseColor("#151923");
    private static final int MUTED = Color.parseColor("#8E96A8"), ACCENT = Color.parseColor("#B8F35A");
    private final List<Caption> captions = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences preferences;
    private Uri videoUri, pendingExportUri;
    private VideoView videoView;
    private CaptionOverlayView overlay;
    private LinearLayout timeline, editorContainer;
    private TextView emptyTitle, emptySubtitle, timeLabel, positionLabel, playButton;
    private EditText captionInput, startInput, endInput;
    private SeekBar seekBar, sizeSlider;
    private ProgressBar exportProgress;
    private TextView exportButton;
    private int selected = 0, duration = 0;
    private boolean loadingEditor, exporting;
    private Transformer transformer;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("project", MODE_PRIVATE);
        buildInterface();
        loadProject();
        handler.post(ticker);
    }

    private void buildInterface() {
        LinearLayout root = column(); root.setBackgroundColor(BG);
        root.setPadding(dp(18), dp(12), dp(18), 0);
        setContentView(root);

        LinearLayout header = row(); header.setGravity(Gravity.CENTER_VERTICAL);
        TextView logo = label("CF", 18, BG); logo.setTypeface(Typeface.DEFAULT_BOLD); logo.setGravity(Gravity.CENTER);
        logo.setBackground(round(ACCENT, 12)); header.addView(logo, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout titles = column(); titles.setPadding(dp(12), 0, 0, 0);
        TextView title = label("CaptionForge", 22, Color.WHITE); title.setTypeface(Typeface.DEFAULT_BOLD);
        titles.addView(title); titles.addView(label("CAPTION STUDIO", 10, MUTED));
        header.addView(titles, new LinearLayout.LayoutParams(0, dp(52), 1));
        exportButton = label("Export  ↗", 14, BG); exportButton.setTypeface(Typeface.DEFAULT_BOLD);
        exportButton.setGravity(Gravity.CENTER); exportButton.setBackground(round(ACCENT, 12));
        exportButton.setOnClickListener(v -> beginExport());
        header.addView(exportButton, new LinearLayout.LayoutParams(dp(102), dp(44)));
        root.addView(header);

        exportProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        exportProgress.setMax(100); exportProgress.setVisibility(View.GONE);
        root.addView(exportProgress, new LinearLayout.LayoutParams(-1, dp(4)));

        FrameLayout stage = new FrameLayout(this); stage.setBackground(round(Color.BLACK, 18));
        LinearLayout.LayoutParams stageParams = new LinearLayout.LayoutParams(-1, dp(330));
        stageParams.topMargin = dp(14); root.addView(stage, stageParams);
        videoView = new VideoView(this); stage.addView(videoView, new FrameLayout.LayoutParams(-1, -1));
        videoView.setOnPreparedListener(mp -> {
            duration = mp.getDuration(); seekBar.setMax(Math.max(duration, 1));
            mp.setOnVideoSizeChangedListener((m, w, h) -> { });
            updateTime();
        });
        videoView.setOnCompletionListener(mp -> { playButton.setText("▶"); updateTime(); });
        videoView.setOnErrorListener((mp, what, extra) -> { toast("This video format cannot be previewed"); return true; });
        LinearLayout empty = column(); empty.setGravity(Gravity.CENTER); empty.setPadding(dp(24), 0, dp(24), 0);
        emptyTitle = label("Make every word land.", 23, Color.WHITE); emptyTitle.setTypeface(Typeface.DEFAULT_BOLD);
        emptySubtitle = label("Import a video, then drag captions anywhere on screen.", 13, MUTED);
        emptySubtitle.setGravity(Gravity.CENTER); emptySubtitle.setPadding(0, dp(8), 0, dp(18));
        TextView importEmpty = action("＋  Import video", true, v -> pickVideo());
        empty.addView(emptyTitle); empty.addView(emptySubtitle); empty.addView(importEmpty, new LinearLayout.LayoutParams(-2, dp(46)));
        stage.addView(empty, new FrameLayout.LayoutParams(-1, -1));
        overlay = new CaptionOverlayView(this); overlay.setChangeListener(this::saveProject);
        stage.addView(overlay, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout transport = row(); transport.setGravity(Gravity.CENTER_VERTICAL); transport.setPadding(0, dp(8), 0, 0);
        playButton = label("▶", 20, Color.WHITE); playButton.setGravity(Gravity.CENTER);
        playButton.setOnClickListener(v -> togglePlayback()); transport.addView(playButton, new LinearLayout.LayoutParams(dp(42), dp(40)));
        seekBar = new SeekBar(this); seekBar.setMax(1000);
        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int p, boolean user) { if (user && videoUri != null) { videoView.seekTo(p); overlay.setTimeMs(p); updateTime(); } }
            public void onStartTrackingTouch(SeekBar s) { }
            public void onStopTrackingTouch(SeekBar s) { }
        });
        transport.addView(seekBar, new LinearLayout.LayoutParams(0, dp(36), 1));
        timeLabel = label("0:00 / 0:00", 11, MUTED); transport.addView(timeLabel);
        root.addView(transport);

        LinearLayout timelineHead = row(); timelineHead.setGravity(Gravity.CENTER_VERTICAL);
        timelineHead.addView(label("CAPTION TIMELINE", 11, MUTED), new LinearLayout.LayoutParams(0, dp(40), 1));
        TextView add = label("＋ Add caption", 13, ACCENT); add.setOnClickListener(v -> addCaption()); timelineHead.addView(add);
        root.addView(timelineHead);
        HorizontalScrollView timelineScroll = new HorizontalScrollView(this); timelineScroll.setHorizontalScrollBarEnabled(false);
        timeline = row(); timelineScroll.addView(timeline, new HorizontalScrollView.LayoutParams(-2, dp(43)));
        root.addView(timelineScroll);

        HorizontalScrollView editorScroll = new HorizontalScrollView(this); editorScroll.setHorizontalScrollBarEnabled(false);
        editorScroll.setFillViewport(true);
        editorContainer = column();
        editorScroll.addView(editorContainer, new HorizontalScrollView.LayoutParams(-1, -1));
        root.addView(editorScroll, new LinearLayout.LayoutParams(-1, 0, 1));
        buildEditor();

        LinearLayout bottom = row(); bottom.setGravity(Gravity.CENTER); bottom.setPadding(0, dp(8), 0, dp(10));
        TextView importButton = action("Import", false, v -> pickVideo());
        TextView splitButton = action("Smart split", false, v -> smartSplit());
        TextView duplicateButton = action("Duplicate", false, v -> duplicateCaption());
        bottom.addView(importButton, weightedButton()); bottom.addView(splitButton, weightedButton()); bottom.addView(duplicateButton, weightedButton());
        root.addView(bottom);
    }

    private void buildEditor() {
        editorContainer.removeAllViews();
        LinearLayout card = column(); card.setPadding(dp(14), dp(10), dp(14), dp(12)); card.setBackground(round(PANEL, 16));
        captionInput = new EditText(this); captionInput.setTextColor(Color.WHITE); captionInput.setHintTextColor(MUTED);
        captionInput.setHint("Write something worth reading…"); captionInput.setTextSize(17); captionInput.setGravity(Gravity.TOP);
        captionInput.setMinLines(2); captionInput.setMaxLines(3); captionInput.setBackground(null); captionInput.setPadding(0, 0, 0, dp(8));
        captionInput.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            public void onTextChanged(CharSequence s, int a, int b, int c) { }
            public void afterTextChanged(Editable s) {
                if (!loadingEditor && validSelection()) { current().text = s.toString(); refreshTimeline(); overlay.invalidate(); saveProject(); }
            }
        });
        card.addView(captionInput, new LinearLayout.LayoutParams(-1, dp(76)));

        LinearLayout styleRow = row();
        addStyleButton(styleRow, "Clean", 0); addStyleButton(styleRow, "Bold", 1);
        addStyleButton(styleRow, "Neon", 2); addStyleButton(styleRow, "Minimal", 3);
        card.addView(styleRow, new LinearLayout.LayoutParams(-1, dp(42)));

        LinearLayout tools = row(); tools.setGravity(Gravity.CENTER_VERTICAL);
        TextView colorsLabel = label("COLOR", 10, MUTED); tools.addView(colorsLabel, new LinearLayout.LayoutParams(dp(48), dp(42)));
        int[] colors = {Color.WHITE, ACCENT, Color.parseColor("#FF6685"), Color.parseColor("#72D6FF"), Color.parseColor("#FFD166")};
        for (int color : colors) {
            View swatch = new View(this); swatch.setBackground(round(color, 20)); swatch.setOnClickListener(v -> { if (validSelection()) { current().color = color; overlay.invalidate(); saveProject(); } });
            LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(27), dp(27)); sp.setMargins(dp(4), 0, dp(4), 0); tools.addView(swatch, sp);
        }
        TextView more = label("More", 12, MUTED); more.setGravity(Gravity.CENTER); more.setOnClickListener(v -> cycleFont()); tools.addView(more, new LinearLayout.LayoutParams(0, dp(40), 1));
        card.addView(tools);

        LinearLayout sizeRow = row(); sizeRow.setGravity(Gravity.CENTER_VERTICAL);
        positionLabel = label("SIZE 54", 10, MUTED); sizeRow.addView(positionLabel, new LinearLayout.LayoutParams(dp(60), dp(34)));
        sizeSlider = new SeekBar(this); sizeSlider.setMax(86); sizeSlider.setProgress(54);
        sizeSlider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int p, boolean user) { if (user && validSelection()) { current().size = p + 22; positionLabel.setText("SIZE " + (p + 22)); overlay.invalidate(); saveProject(); } }
            public void onStartTrackingTouch(SeekBar s) { } public void onStopTrackingTouch(SeekBar s) { }
        });
        sizeRow.addView(sizeSlider, new LinearLayout.LayoutParams(0, dp(34), 1));
        TextView animation = action("Animation", false, v -> cycleAnimation()); sizeRow.addView(animation, new LinearLayout.LayoutParams(dp(96), dp(34)));
        card.addView(sizeRow);

        LinearLayout timing = row(); timing.setGravity(Gravity.CENTER_VERTICAL);
        timing.addView(label("START", 10, MUTED), new LinearLayout.LayoutParams(dp(46), dp(40)));
        startInput = timingField(); timing.addView(startInput, new LinearLayout.LayoutParams(dp(62), dp(40)));
        timing.addView(label("  END", 10, MUTED), new LinearLayout.LayoutParams(dp(46), dp(40)));
        endInput = timingField(); timing.addView(endInput, new LinearLayout.LayoutParams(dp(62), dp(40)));
        TextView delete = label("Delete", 12, Color.parseColor("#FF8297")); delete.setGravity(Gravity.CENTER);
        delete.setOnClickListener(v -> deleteCaption()); timing.addView(delete, new LinearLayout.LayoutParams(0, dp(40), 1));
        card.addView(timing);
        editorContainer.addView(card);
    }

    private void addStyleButton(LinearLayout parent, String name, int preset) {
        TextView b = label(name, 12, Color.WHITE); b.setGravity(Gravity.CENTER); b.setBackground(round(Color.parseColor("#252B38"), 9));
        b.setOnClickListener(v -> applyPreset(preset));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(34), 1); p.setMargins(dp(3), 0, dp(3), 0); parent.addView(b, p);
    }

    private EditText timingField() {
        EditText e = new EditText(this); e.setTextColor(Color.WHITE); e.setTextSize(12); e.setGravity(Gravity.CENTER);
        e.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        e.setBackground(round(Color.parseColor("#252B38"), 8)); e.setSelectAllOnFocus(true);
        e.setOnFocusChangeListener((v, focused) -> { if (!focused) applyTiming(); }); return e;
    }

    private LinearLayout.LayoutParams weightedButton() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(42), 1); p.setMargins(dp(3), 0, dp(3), 0); return p;
    }

    private void pickVideo() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("video/*"); startActivityForResult(i, PICK_VIDEO);
    }

    private void setVideo(Uri uri) {
        videoUri = uri;
        try { getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) { }
        videoView.setVideoURI(uri); videoView.seekTo(1);
        View empty = emptyTitle.getParent() instanceof View ? (View) emptyTitle.getParent() : null;
        if (empty != null) empty.setVisibility(View.GONE);
        if (captions.isEmpty()) addCaption(); else { selected = 0; loadEditor(); refreshTimeline(); }
        saveProject();
    }

    private void togglePlayback() {
        if (videoUri == null) { pickVideo(); return; }
        if (videoView.isPlaying()) { videoView.pause(); playButton.setText("▶"); }
        else { if (duration > 0 && videoView.getCurrentPosition() >= duration - 100) videoView.seekTo(0); videoView.start(); playButton.setText("Ⅱ"); }
    }

    private void addCaption() {
        Caption c = new Caption(); c.startMs = videoUri == null ? 0 : videoView.getCurrentPosition();
        c.endMs = duration > 0 ? Math.min(duration, c.startMs + 3000) : c.startMs + 3000;
        captions.add(c); selected = captions.size() - 1; loadEditor(); refreshTimeline(); saveProject();
    }

    private void duplicateCaption() {
        if (!validSelection()) return;
        Caption c = current().copy(); c.startMs = Math.min(current().endMs + 100, Math.max(0, duration - 2000));
        c.endMs = c.startMs + (current().endMs - current().startMs); c.y = Math.min(.92f, c.y + .07f);
        captions.add(c); selected = captions.size() - 1; loadEditor(); refreshTimeline(); saveProject();
    }

    private void deleteCaption() {
        if (!validSelection()) return;
        captions.remove(selected); selected = Math.max(0, Math.min(selected, captions.size() - 1));
        if (captions.isEmpty()) captions.add(new Caption());
        loadEditor(); refreshTimeline(); saveProject();
    }

    private void smartSplit() {
        if (!validSelection()) return;
        Caption original = current(); String[] words = original.text.trim().split("\\s+");
        if (words.length < 3) { toast("Add at least three words to use Smart split"); return; }
        int groups = Math.min(6, Math.max(2, (words.length + 2) / 3));
        int per = (int) Math.ceil(words.length / (double) groups);
        long total = Math.max(500, original.endMs - original.startMs), start = original.startMs;
        List<Caption> split = new ArrayList<>();
        for (int from = 0; from < words.length; from += per) {
            Caption c = original.copy(); StringBuilder text = new StringBuilder();
            for (int j = from; j < Math.min(words.length, from + per); j++) { if (text.length() > 0) text.append(' '); text.append(words[j]); }
            c.text = text.toString(); c.startMs = start; c.endMs = from + per >= words.length ? original.endMs : start + total / groups;
            start = c.endMs; split.add(c);
        }
        captions.remove(selected); captions.addAll(selected, split); loadEditor(); refreshTimeline(); saveProject(); toast(split.size() + " timed captions created");
    }

    private void applyPreset(int preset) {
        if (!validSelection()) return;
        Caption c = current();
        if (preset == 0) { c.font = 0; c.bold = false; c.color = Color.WHITE; c.background = true; c.size = 48; c.animation = 1; }
        if (preset == 1) { c.font = 0; c.bold = true; c.uppercase = true; c.color = Color.WHITE; c.background = true; c.size = 66; c.animation = 2; }
        if (preset == 2) { c.font = 2; c.bold = true; c.color = ACCENT; c.background = false; c.size = 58; c.animation = 4; }
        if (preset == 3) { c.font = 1; c.bold = false; c.uppercase = false; c.color = Color.WHITE; c.background = false; c.size = 52; c.animation = 3; }
        loadEditor(); overlay.invalidate(); saveProject();
    }

    private void cycleFont() {
        if (!validSelection()) return;
        String[] options = {"Sans", "Serif", "Monospace", "Toggle UPPERCASE", "Toggle background", "Align left / center / right"};
        new AlertDialog.Builder(this).setTitle("Typography").setItems(options, (d, which) -> {
            Caption c = current();
            if (which < 3) c.font = which; else if (which == 3) c.uppercase = !c.uppercase;
            else if (which == 4) c.background = !c.background; else c.align = (c.align + 1) % 3;
            overlay.invalidate(); saveProject();
        }).show();
    }

    private void cycleAnimation() {
        if (!validSelection()) return;
        String[] options = {"None", "Fade in", "Pop in", "Rise up", "Typewriter"};
        new AlertDialog.Builder(this).setTitle("Caption animation").setSingleChoiceItems(options, current().animation, (d, which) -> {
            current().animation = which; overlay.invalidate(); saveProject(); d.dismiss();
        }).show();
    }

    private void applyTiming() {
        if (!validSelection() || loadingEditor) return;
        try {
            long start = (long) (Double.parseDouble(startInput.getText().toString()) * 1000);
            long end = (long) (Double.parseDouble(endInput.getText().toString()) * 1000);
            if (start < 0 || end <= start) { toast("End time must be after start time"); loadEditor(); return; }
            current().startMs = start; current().endMs = end; refreshTimeline(); overlay.invalidate(); saveProject();
        } catch (Exception e) { loadEditor(); }
    }

    private void refreshTimeline() {
        timeline.removeAllViews();
        for (int i = 0; i < captions.size(); i++) {
            Caption c = captions.get(i); final int index = i;
            LinearLayout chip = column(); chip.setGravity(Gravity.CENTER); chip.setPadding(dp(12), 0, dp(12), 0);
            chip.setBackground(round(i == selected ? ACCENT : Color.parseColor("#252B38"), 10));
            TextView text = label((i + 1) + "  " + shortText(c.text), 11, i == selected ? BG : Color.WHITE);
            chip.addView(text); chip.setOnClickListener(v -> { selected = index; videoView.seekTo((int) c.startMs); loadEditor(); refreshTimeline(); });
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(138), dp(36)); p.setMargins(0, 0, dp(7), 0); timeline.addView(chip, p);
        }
        if (overlay != null) overlay.setCaptions(captions, selected);
    }

    private void loadEditor() {
        loadingEditor = true;
        if (!captions.isEmpty()) {
            selected = Math.max(0, Math.min(selected, captions.size() - 1)); Caption c = current();
            captionInput.setText(c.text); captionInput.setSelection(captionInput.length());
            startInput.setText(seconds(c.startMs)); endInput.setText(seconds(c.endMs));
            sizeSlider.setProgress(Math.max(0, c.size - 22)); positionLabel.setText("SIZE " + c.size);
        }
        loadingEditor = false; refreshTimeline();
    }

    private void updateTime() {
        int now = videoUri == null ? 0 : videoView.getCurrentPosition();
        timeLabel.setText(format(now) + " / " + format(duration));
        if (!seekBar.isPressed()) seekBar.setProgress(now);
        overlay.setTimeMs(now);
    }

    private final Runnable ticker = new Runnable() { @Override public void run() { updateTime(); handler.postDelayed(this, 33); } };

    private void beginExport() {
        if (exporting) return;
        if (videoUri == null) { toast("Import a video first"); return; }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("video/mp4");
        i.putExtra(Intent.EXTRA_TITLE, "CaptionForge-" + System.currentTimeMillis() + ".mp4"); startActivityForResult(i, CREATE_VIDEO);
    }

    private void exportVideo() {
        if (pendingExportUri == null) return;
        exporting = true; exportProgress.setVisibility(View.VISIBLE); exportProgress.setProgress(0);
        exportButton.setText("Rendering…"); exportButton.setEnabled(false); videoView.pause(); playButton.setText("▶");
        try {
            MediaMetadataRetriever meta = new MediaMetadataRetriever(); meta.setDataSource(this, videoUri);
            int width = Integer.parseInt(meta.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            int height = Integer.parseInt(meta.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
            int rotation = Integer.parseInt(meta.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION));
            meta.release(); if (rotation == 90 || rotation == 270) { int t = width; width = height; height = t; }
            float scale = Math.min(1f, 1080f / Math.max(width, height)); width = even(width * scale); height = even(height * scale);
            List<Caption> snapshot = new ArrayList<>(); for (Caption c : captions) snapshot.add(c.copy());
            List<Effect> effects = new ArrayList<>();
            effects.add(Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT));
            effects.add(new OverlayEffect(ImmutableList.of(new ExportOverlay(width, height, snapshot))));
            EditedMediaItem item = new EditedMediaItem.Builder(MediaItem.fromUri(videoUri)).setEffects(new Effects(ImmutableList.of(), ImmutableList.copyOf(effects))).build();
            File output = new File(getCacheDir(), "captionforge-export.mp4"); if (output.exists()) output.delete();
            transformer = new Transformer.Builder(this).setVideoMimeType(MimeTypes.VIDEO_H264).addListener(new Transformer.Listener() {
                @Override public void onCompleted(Composition composition, ExportResult result) { copyExport(output); }
                @Override public void onError(Composition composition, ExportResult result, ExportException error) { finishExport(false, error.getMessage()); }
            }).build();
            transformer.start(item, output.getAbsolutePath());
            pollExport();
        } catch (Exception e) { finishExport(false, e.getMessage()); }
    }

    private void pollExport() {
        if (!exporting || transformer == null) return;
        ProgressHolder holder = new ProgressHolder(); int state = transformer.getProgress(holder);
        if (state == Transformer.PROGRESS_STATE_AVAILABLE) exportProgress.setProgress(holder.progress);
        handler.postDelayed(this::pollExport, 350);
    }

    private void copyExport(File output) {
        new Thread(() -> {
            try (FileInputStream in = new FileInputStream(output); OutputStream out = getContentResolver().openOutputStream(pendingExportUri, "wt")) {
                byte[] buffer = new byte[1024 * 256]; int count; while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count); out.flush();
                runOnUiThread(() -> finishExport(true, null));
            } catch (Exception e) { runOnUiThread(() -> finishExport(false, e.getMessage())); }
        }).start();
    }

    private void finishExport(boolean success, String error) {
        exporting = false; exportProgress.setVisibility(View.GONE); exportButton.setEnabled(true); exportButton.setText("Export  ↗");
        if (transformer != null) { transformer.cancel(); transformer = null; }
        if (success) new AlertDialog.Builder(this).setTitle("Your reel is ready ✓").setMessage("CaptionForge saved the captioned MP4 to your chosen location.").setPositiveButton("Done", null).show();
        else toast("Export failed: " + (error == null ? "unsupported video" : error));
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        if (request == PICK_VIDEO) setVideo(data.getData());
        if (request == CREATE_VIDEO) { pendingExportUri = data.getData(); exportVideo(); }
    }

    private void saveProject() {
        if (preferences == null) return;
        try {
            JSONObject root = new JSONObject(); root.put("video", videoUri == null ? "" : videoUri.toString()); JSONArray array = new JSONArray();
            for (Caption c : captions) array.put(c.toJson()); root.put("captions", array); root.put("selected", selected);
            preferences.edit().putString("autosave", root.toString()).apply();
        } catch (Exception ignored) { }
    }

    private void loadProject() {
        try {
            JSONObject root = new JSONObject(preferences.getString("autosave", "{}")); JSONArray array = root.optJSONArray("captions");
            if (array != null) for (int i = 0; i < array.length(); i++) captions.add(Caption.fromJson(array.getJSONObject(i)));
            selected = root.optInt("selected", 0); String savedVideo = root.optString("video", "");
            if (captions.isEmpty()) captions.add(new Caption());
            loadEditor();
            if (!savedVideo.isEmpty()) { videoUri = Uri.parse(savedVideo); videoView.setVideoURI(videoUri); emptyTitle.post(() -> ((View) emptyTitle.getParent()).setVisibility(View.GONE)); }
        } catch (Exception e) { captions.clear(); captions.add(new Caption()); loadEditor(); }
    }

    private Caption current() { return captions.get(selected); }
    private boolean validSelection() { return selected >= 0 && selected < captions.size(); }
    private static int even(float value) { int v = Math.max(2, Math.round(value)); return v % 2 == 0 ? v : v - 1; }
    private static String seconds(long ms) { return String.format(Locale.US, "%.2f", ms / 1000f); }
    private static String format(long ms) { long s = ms / 1000; return String.format(Locale.US, "%d:%02d", s / 60, s % 60); }
    private static String shortText(String s) { return s.length() > 17 ? s.substring(0, 16) + "…" : s; }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private static GradientDrawable round(int color, int radius) { GradientDrawable g = new GradientDrawable(); g.setColor(color); g.setCornerRadius(radius); return g; }
    private TextView label(String text, int size, int color) { TextView t = new TextView(this); t.setText(text); t.setTextSize(size); t.setTextColor(color); return t; }
    private LinearLayout column() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); return l; }
    private LinearLayout row() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.HORIZONTAL); return l; }
    private TextView action(String text, boolean primary, View.OnClickListener listener) {
        TextView t = label(text, 13, primary ? BG : Color.WHITE); t.setGravity(Gravity.CENTER); t.setBackground(round(primary ? ACCENT : Color.parseColor("#252B38"), 11)); t.setOnClickListener(listener); return t;
    }

    @Override protected void onPause() { super.onPause(); saveProject(); if (videoView != null) videoView.pause(); }
    @Override protected void onDestroy() { handler.removeCallbacksAndMessages(null); if (transformer != null) transformer.cancel(); super.onDestroy(); }
}
