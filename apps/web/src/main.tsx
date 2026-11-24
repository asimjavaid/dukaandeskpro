import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { CustomerDisplay } from './features/display/CustomerDisplay';
import { isDisplayWindow } from './features/display/displayChannel';
import { LicenseGate } from './features/license/LicenseGate';
import { TillLink } from './features/tills/TillLink';
import { I18nProvider } from './i18n';
import './styles/global.css';
import './styles/flat.css';
import './styles/customers.css';
import './styles/customer-display.css';
import { applyTheme, watchTheme } from './features/shared/theme';

// Colour theme A / B / C (index.html sets it before first paint; this keeps it in step).
applyTheme();
watchTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      {isDisplayWindow() ? (
        <LicenseGate>
          <CustomerDisplay />
        </LicenseGate>
      ) : (
        <TillLink>
          <LicenseGate>
            <App />
          </LicenseGate>
        </TillLink>
      )}
    </I18nProvider>
  </StrictMode>,
);
