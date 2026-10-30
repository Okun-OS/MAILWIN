# Microsoft 365 / Outlook einrichten

Damit Kunden ihr Microsoft-Postfach (Firmenkonto oder Outlook.com/Hotmail) verbinden können, braucht Mailwin eine App-Registrierung bei Microsoft. Das ist ähnlich wie der OAuth-Client bei Google.

1. **portal.azure.com** öffnen, mit einem Microsoft-Konto anmelden.
2. **Microsoft Entra ID** → **App-Registrierungen** → **Neue Registrierung**:
   - Name: `OKUN Mailwin`
   - Unterstützte Kontotypen: **Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten**
   - Umleitungs-URI: Plattform **Web**, `https://okun-mailwin.com/api/auth/microsoft/callback`
3. In der neuen App: **Zertifikate & Geheimnisse** → **Neuer geheimer Clientschlüssel**. Den **Wert** sofort kopieren; er wird nur einmal angezeigt.
4. **API-Berechtigungen** → **Berechtigung hinzufügen** → **Microsoft Graph** → **Delegierte Berechtigungen**:
   `offline_access`, `openid`, `email`, `profile`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.Read`
5. In Railway eintragen (Web-Service und Worker):
   - `MICROSOFT_CLIENT_ID` = **Anwendungs-ID (Client)** von der Übersichtsseite
   - `MICROSOFT_CLIENT_SECRET` = der Wert aus Schritt 3

**Gut zu wissen**
- Der geheime Clientschlüssel läuft ab, standardmäßig nach 6 bis 24 Monaten. Rechtzeitig einen neuen anlegen und in Railway tauschen.
- Manche Firmen erlauben Mitarbeitern nicht, Apps selbst zuzustimmen. Dann muss deren IT einmalig die Administratorzustimmung erteilen.
- Für die Veröffentlichung empfiehlt Microsoft die **Herausgeberüberprüfung** (Publisher Verification) über ein Microsoft-Partner-Konto. Ohne sie zeigt der Zustimmungsdialog „nicht überprüft“.
