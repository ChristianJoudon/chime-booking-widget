import { type FC } from 'react';

interface HeaderProps {
  title: string;
}

const Header: FC<HeaderProps> = ({ title }) => (
  <header className="chime-header">
    <div className="chime-header__inner">
      <div className="chime-logo" aria-hidden="true">
        <span />
      </div>
      <div className="chime-header__text">
        <p className="chime-header__eyebrow">Appointment concierge</p>
        <h1 className="chime-header__title">{title}</h1>
      </div>
    </div>
  </header>
);

export default Header;
