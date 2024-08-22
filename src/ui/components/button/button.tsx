import styles from "./button.module.css";

export type ButtonStyle = "primary" | "default";
export type ButtonIcon = "sync" | "check" | "error" | "cog";

interface ButtonProps {
  name: string;
  style?: ButtonStyle;
  icon?: ButtonIcon;
  onClick: () => void;
}

const Button = ({ name, style = "default", icon, onClick }: ButtonProps) => {
  return (
    <button className={styles[style]} onClick={onClick}>
      <div className={styles["button-group"]}>{name}</div>
    </button>
  );
};

export default Button;
