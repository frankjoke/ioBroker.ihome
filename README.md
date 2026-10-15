# iHome — adapter for ioBroker

iHome is a dashboard adapter for ioBroker home automation, built with Svelte: a responsive Single Page Application (SPA, installable as a PWA) for monitoring and controlling your smart home devices.

## Features

- **Modern Tech Stack**: Built with SvelteKit for optimal performance
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **SPA Architecture**: Single Page Application for smooth user experience
- **PWA Ready**: Easy conversion to Progressive Web App
- **ioBroker Integration**: Full integration with ioBroker states and objects
- **Device Control**: Monitor and control lights, switches, sensors, locks, and more
- **Real-time Updates**: Live state synchronization with ioBroker
- **Customizable Dashboard**: Widget-based interface for personalized views
- **Theme Support**: Light/dark mode support with customizable colors

## Project Structure

```
ioBroker-visual-adapter/
├── src/
│   ├── app.css              # Global styles
│   └── routes/
│       ├── +layout.svelte   # Root layout
│       ├── +page.svelte     # Home/dashboard page
│       └── devices/
│           └── +page.svelte # Devices management page
├── www/                     # Built static assets (generated)
├── build/                   # SvelteKit build output (generated)
├── lib/                     # Compiled adapter code (generated)
├── admin/                   # ioBroker admin interface files
├── test/                    # Test files
├── main.js                  # Adapter entry point
├── io-package.json          # ioBroker adapter metadata
├── package.json             # Node.js dependencies and scripts
├── svelte.config.js         # Svelte configuration
├── vite.config.js           # Vite build configuration
└── tsconfig.json            # TypeScript configuration
```

## Installation

### Development Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/frankjoke/ioBroker.ihome.git
   cd ioBroker.ihome
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   ```

### ioBroker Installation

1. Build the adapter:
   ```bash
   npm run build
   ```

2. Package the adapter:
   ```bash
   npm run package
   ```

3. Install in ioBroker:
   - Go to ioBroker Admin → Adapters → + (plus icon)
   - Choose "Install from URL" or "Local installation"
   - Point to the generated `.tgz` file

## Configuration

The adapter can be configured through the ioBroker Admin interface:

- **Width**: Display width in pixels (default: 800)
- **Height**: Display height in pixels (default: 600)
- **Background Color**: Background color for the interface (default: #ffffff)
- **Refresh Interval**: Data refresh interval in seconds (default: 5)

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test:js` - Run JavaScript tests
- `npm run test:package` - Validate package files
- `npm run test:integration` - Run integration tests
- `npm run test` - Run all tests
- `npm run check` - Type checking
- `npm run lint` - ESLint validation
- `npm run translate` - Translation management
- `npm run release` - Create new release

### File Structure Details

#### Adapter Files
- `main.js` - Entry point for the ioBroker adapter
- `io-package.json` - ioBroker-specific metadata and configuration
- `package.json` - Node.js dependencies and scripts

#### Svelte Application
- `src/routes/+layout.svelte` - Root layout with header, navigation, and footer
- `src/routes/+page.svelte` - Home/dashboard page with widgets
- `src/routes/devices/+page.svelte` - Devices management page
- `src/app.css` - Global styles and utilities
- `svelte.config.js` - SvelteKit configuration
- `vite.config.js` - Vite build configuration

#### Build Output
- `www/` - Static assets served by ioBroker (generated)
- `build/` - SvelteKit build output (generated)
- `lib/` - Compiled adapter JavaScript (generated)

## Customization

### Adding New Pages
Create new Svelte routes in `src/routes/`:
- `src/routes/new-page/+page.svelte` - Page component
- `src/routes/new-page/+layout.svelte` - Optional layout for the page

### Adding Widgets
Modify the dashboard widgets in `src/routes/+page.svelte`:
1. Add new widget objects to the `widgets` array
2. Create corresponding data fetching logic
3. Update the UI template as needed

### Styling
- Modify `src/app.css` for global style changes
- Use utility classes for rapid prototyping
- Override CSS variables in `:root` for theming

## PWA Conversion

To convert this SPA to a PWA:

1. Update `svelte.config.js` to use `@sveltejs/adapter-static` with PWA options
2. Add a service worker (`src/service-worker.js`)
3. Create a manifest file (`src/manifest.json`)
4. Update the `vite.config.js` to generate PWA assets
5. Add PWA meta tags to the layout

## Testing

### Unit Tests
Write tests in the `test/` directory following the existing patterns:
- Adapter logic tests in `test/`
- Svelte component tests using testing libraries

### Integration Tests
Integration tests verify the adapter works correctly with ioBroker:
- State synchronization
- Object creation and updates
- Adapter lifecycle events

## Building for Production

```bash
# Install dependencies
npm install

# Build the Svelte frontend
npm run build

# Build the adapter package
npm run package

# The package will be available as:
# iobroker.ihome-0.0.1.tgz
```

## License

MIT License

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

For issues, questions, or feature requests, please use the GitHub Issues section of this repository.

---

*Built with ❤️ for the ioBroker community*