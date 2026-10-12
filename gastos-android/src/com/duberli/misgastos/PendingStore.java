package com.duberli.misgastos;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;

/**
 * Cola de textos de notificaciones de pago que todavía no se anotaron en la
 * app. NotificationReader los agrega aunque la app esté cerrada; la parte web
 * los toma (takePending) al abrirse y los guarda como gastos.
 */
final class PendingStore {
    private static final String PREFS = "pendientes";
    private static final String KEY_QUEUE = "cola";
    private static final String KEY_SEEN = "vistos";
    private static final long SEEN_TTL_MS = 24L * 60 * 60 * 1000;
    private static final int MAX_QUEUE = 200;

    private PendingStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Agrega el texto si no se vio en las últimas 24 h. Devuelve false si era repetido. */
    static synchronized boolean add(Context c, String text) {
        SharedPreferences p = prefs(c);
        long now = System.currentTimeMillis();
        String key = Integer.toHexString(text.hashCode()) + ":" + text.length();
        try {
            JSONObject seen = new JSONObject(p.getString(KEY_SEEN, "{}"));
            Iterator<String> it = seen.keys();
            while (it.hasNext()) {
                if (now - seen.optLong(it.next()) > SEEN_TTL_MS) it.remove();
            }
            if (seen.has(key)) return false;
            seen.put(key, now);

            JSONArray queue = new JSONArray(p.getString(KEY_QUEUE, "[]"));
            if (queue.length() >= MAX_QUEUE) queue.remove(0);
            queue.put(text);
            p.edit().putString(KEY_SEEN, seen.toString()).putString(KEY_QUEUE, queue.toString()).apply();
            return true;
        } catch (JSONException e) {
            p.edit().remove(KEY_SEEN).remove(KEY_QUEUE).apply();
            return false;
        }
    }

    /** Devuelve todos los textos pendientes (JSON) y vacía la cola. */
    static synchronized String take(Context c) {
        SharedPreferences p = prefs(c);
        String queue = p.getString(KEY_QUEUE, "[]");
        p.edit().putString(KEY_QUEUE, "[]").apply();
        return queue;
    }
}
