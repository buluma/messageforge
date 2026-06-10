# 🎨 Theming System

MessageForge features a unique "Theming Engine" that allows the bot to adopt different personalities, voice styles, and visual appearances.

## 🎭 Available Themes

You can switch themes instantly using the `.settheme <name>` command or by setting the `THEME` environment variable.

| Theme          | Character      | Style                                             |
| -------------- | -------------- | ------------------------------------------------- |
| `messageforge` | MessageForge   | **Default** — Clean, professional, and efficient. |
| `naruto`       | Naruto Uzumaki | Energetic, ninja-themed responses.                |
| `gojo`         | Satoru Gojo    | Confident, powerful, and slightly arrogant.       |
| `batman`       | The Batman     | Dark, serious, and focused on justice.            |
| `zerotwo`      | Zero Two       | Playful, anime-inspired style.                    |
| `friday`       | FRIDAY         | Stark Industries AI assistant style.              |

---

## 🛠️ Customizing Themes

Themes are stored as JSON files in the `/themes` directory.

### Structure of a Theme File

Each theme file (e.g., `gojo.json`) contains a `STRINGS` object:

```json
{
    "name": "Gojo",
    "STRINGS": {
        "global": {
            "botName": "Satoru Gojo",
            "footer": "Infinite Void",
            "greet": "Throughout Heaven and Earth, I alone am the honored one.",
            "error": "My domain failed... something went wrong."
        }
    }
}
```

### Adding Your Own Theme

1. Create a new JSON file in the `themes/` folder (e.g., `my-theme.json`).
2. Follow the structure above.
3. Restart the bot or use `.settheme my-theme`.

---

## 🏗️ Theme Inheritance

If a specific string is missing from a custom theme, the bot will automatically fall back to the default `messageforge` theme strings to prevent errors.
