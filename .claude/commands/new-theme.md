# /new-theme

Scaffold a complete theme — LESS token overrides and icon asset folder.

## What you provide
- `$ARGUMENTS`: theme name in kebab-case (e.g. `light`, `high-contrast`, `solarized`)

## What gets created
- `styles/themes/{name}.less` — CSS custom property overrides for `body[data-theme="{name}"]`
- `assets/themes/{name}/icons/` — empty folder tree mirroring default/ (icons fall back to default)
- Import line added to `styles/main.less`

## Steps
1. Read `styles/themes/light.less` as the reference for the token override format.
2. Read `styles/core/variables.less` to see all available `--theme-*` tokens.
3. Generate `styles/themes/{name}.less` with ALL tokens populated (copy from dark as baseline).
4. Create the empty icon folder tree.
5. Add `@import 'themes/{name}';` to `styles/main.less` after the existing theme imports.
6. Run `npm run css` to verify clean compilation.

## Generated LESS file structure
```less
// {Name} theme — override only tokens that differ from dark (default)
body[data-theme="{name}"] {
  --theme-bg:           /* background */;
  --theme-bg-raised:    /* panel background */;
  --theme-bg-hover:     /* hover state */;
  --theme-bg-active:    /* active/pressed state */;
  --theme-border:       /* border color */;
  --theme-fg:           /* primary text/icon */;
  --theme-fg-dim:       /* secondary text */;
  --theme-accent:       /* brand/interactive color */;
  --theme-accent-fg:    /* text on accent background */;
  --theme-accent-hover: /* accent hover */;
  --theme-selection:    /* selection fill (semi-transparent) */;
  --theme-danger:       /* destructive action color */;
  --theme-shadow:       /* drop shadow */;
  --theme-pasteboard:   /* canvas background outside artboard */;
  --theme-artboard-bg:  /* artboard fill */;
  --theme-icon-path:    'assets/themes/{name}'; /* icon theme path */
}
```

## High-impact tokens to prioritize
1. `--theme-bg` and `--theme-bg-raised` — sets the overall tone
2. `--theme-fg` and `--theme-fg-dim` — text legibility
3. `--theme-accent` — interactive color (buttons, selection, focus rings)
4. `--theme-border` — panel and input edges

## Icon overrides (optional)
Copy only the SVG files you want to override into `assets/themes/{name}/icons/`.
The icon loader falls back to `assets/themes/default/` for any missing icons.

## Reference
`.claude/docs/THEME-GUIDE.md` — full theming guide with token reference table
