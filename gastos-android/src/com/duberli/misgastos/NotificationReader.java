package com.duberli.misgastos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Escucha las notificaciones del celular (con el permiso "acceso a
 * notificaciones") y guarda en PendingStore las que parecen un pago: avisos
 * de consumo del banco, Yape/Plin o correos de Gmail con un monto.
 */
public class NotificationReader extends NotificationListenerService {

    private static final int FLAGS = Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;

    /** Un monto: "S/ 45.90", "S/.12", "US$ 9.99", "$ 20", "45.90 soles". */
    static final Pattern AMOUNT = Pattern.compile(
            "(S/\\.?|US\\$|USD|PEN|\\$)\\s*\\d|\\d[\\d.,]*\\s*(soles|d[oó]lares)", FLAGS);

    /** Palabras de un gasto. */
    static final Pattern SPEND = Pattern.compile(
            "consumo|compra|cargo|pagaste|pago|yapeaste|plineaste|transferiste|transferencia|retiro"
                    + "|tarjeta|d[eé]bito|cr[eé]dito|operaci[oó]n", FLAGS);

    /** Dinero que entra o mensajes de seguridad: no son gastos. */
    static final Pattern NOT_SPEND = Pattern.compile(
            "te yape[oó]|recibiste|te transfiri[oó]|te envi[oó]|abono|abonamos|dep[oó]sito|reembolso"
                    + "|devoluci[oó]n|extorno|c[oó]digo de (verificaci|seguridad|validaci|acceso)|clave din[aá]mica|\\botp\\b"
                    + "|token digital|promoci[oó]n|oferta"
                    + "|descuento|sorteo|gana ", FLAGS);

    /** Apps de chat: un mensaje de un amigo con un monto no es un pago tuyo. */
    private static final Set<String> IGNORED = new HashSet<>(Arrays.asList(
            "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger", "com.facebook.orca",
            "com.instagram.android", "com.facebook.katana", "com.discord", "com.snapchat.android",
            "com.zhiliaoapp.musically", "com.google.android.youtube"));

    static final String CHANNEL_ID = "pagos";
    private static int notifId = 1000;

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String pkg = sbn.getPackageName();
        if (getPackageName().equals(pkg) || IGNORED.contains(pkg)) return;

        Notification n = sbn.getNotification();
        if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

        String text = extractText(n.extras);
        if (!looksLikePayment(text)) return;
        if (!PendingStore.add(this, text)) return;

        MainActivity.notifyNewPending();
        showDetected(this, text);
    }

    static String extractText(Bundle ex) {
        if (ex == null) return "";
        CharSequence title = ex.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence body = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (body == null || body.length() == 0) body = ex.getCharSequence(Notification.EXTRA_TEXT);
        StringBuilder sb = new StringBuilder();
        if (title != null) sb.append(title).append(". ");
        if (body != null) sb.append(body);
        return sb.toString().replaceAll("\\s+", " ").trim();
    }

    static boolean looksLikePayment(String text) {
        return text.length() > 0
                && text.length() < 4000
                && AMOUNT.matcher(text).find()
                && SPEND.matcher(text).find()
                && !NOT_SPEND.matcher(text).find();
    }

    private static void showDetected(Context c, String text) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, c.getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW));
        }
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, piFlags);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(c, CHANNEL_ID)
                : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("Pago detectado")
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text + "\n\nToca para anotarlo en Mis Gastos."))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setColor(0xFF0F766E);
        try {
            nm.notify(notifId++, b.build());
        } catch (SecurityException ignored) {
            // Sin permiso de notificaciones (Android 13+): el pago igual queda en la cola.
        }
    }
}
