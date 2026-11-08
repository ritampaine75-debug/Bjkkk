package com.captionforge.editor;

import android.graphics.Color;
import org.json.JSONException;
import org.json.JSONObject;

public class Caption {
    public String text = "Your story starts here";
    public long startMs = 0;
    public long endMs = 3000;
    public float x = 0.5f;
    public float y = 0.76f;
    public int size = 54;
    public int color = Color.WHITE;
    public int backgroundColor = Color.parseColor("#C010141D");
    public boolean background = true;
    public boolean bold = true;
    public boolean uppercase = false;
    public int align = 1; // 0 left, 1 center, 2 right
    public int animation = 1; // 0 none, 1 fade, 2 pop, 3 rise, 4 typewriter
    public int font = 0; // 0 sans, 1 serif, 2 mono

    public Caption copy() {
        Caption c = new Caption();
        c.text = text; c.startMs = startMs; c.endMs = endMs; c.x = x; c.y = y;
        c.size = size; c.color = color; c.backgroundColor = backgroundColor;
        c.background = background; c.bold = bold; c.uppercase = uppercase;
        c.align = align; c.animation = animation; c.font = font;
        return c;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("text", text); o.put("start", startMs); o.put("end", endMs);
        o.put("x", x); o.put("y", y); o.put("size", size); o.put("color", color);
        o.put("bgColor", backgroundColor); o.put("background", background);
        o.put("bold", bold); o.put("uppercase", uppercase); o.put("align", align);
        o.put("animation", animation); o.put("font", font);
        return o;
    }

    public static Caption fromJson(JSONObject o) {
        Caption c = new Caption();
        c.text = o.optString("text", c.text); c.startMs = o.optLong("start", 0);
        c.endMs = o.optLong("end", 3000); c.x = (float) o.optDouble("x", .5);
        c.y = (float) o.optDouble("y", .76); c.size = o.optInt("size", 54);
        c.color = o.optInt("color", Color.WHITE); c.backgroundColor = o.optInt("bgColor", c.backgroundColor);
        c.background = o.optBoolean("background", true); c.bold = o.optBoolean("bold", true);
        c.uppercase = o.optBoolean("uppercase", false); c.align = o.optInt("align", 1);
        c.animation = o.optInt("animation", 1); c.font = o.optInt("font", 0);
        return c;
    }
}
