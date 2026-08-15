import { type FC } from 'react';
import chimeBell from '@/assets/brand/chime-bell.png';
import chimeWordmark from '@/assets/brand/chime-wordmark.png';
import chimeWordmarkSmile from '@/assets/brand/chime-wordmark-smile.png';
import type { WidgetLogoVariant } from '@/types/widget';

interface HeaderProps {
  title: string;
  eyebrow?: string;
  logoVariant?: WidgetLogoVariant;
  customLogoUrl?: string;
}

const builtInLogos: Record<Exclude<WidgetLogoVariant, 'custom' | 'none'>, string> = {
  wordmark: chimeWordmark,
  'wordmark-smile': chimeWordmarkSmile,
  bell: chimeBell,
};

const Header: FC<HeaderProps> = ({
  title,
  eyebrow = 'Appointment concierge',
  logoVariant = 'wordmark-smile',
  customLogoUrl,
}) => {
  const logoUrl = logoVariant === 'custom' ? customLogoUrl : logoVariant === 'none' ? undefined : builtInLogos[logoVariant];
  const iconLogo = logoVariant === 'bell';

  return (
    <header className="chime-header">
      <div className="chime-header__inner">
        {logoUrl ? (
          <div className={`chime-logo${iconLogo ? ' chime-logo--icon' : ''}`}>
            <img src={logoUrl} alt={logoVariant === 'custom' ? `${title} logo` : 'Chime'} />
          </div>
        ) : null}
        <div className="chime-header__text">
          <p className="chime-header__eyebrow">{eyebrow}</p>
          <h1 className="chime-header__title">{title}</h1>
        </div>
      </div>
    </header>
  );
};

export default Header;
