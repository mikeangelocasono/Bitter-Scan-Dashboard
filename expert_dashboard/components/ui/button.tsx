"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { clsx } from "clsx";

type Variant = "default" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant = "default", size = "md", ...props }, ref) => {
        const base = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none disabled:opacity-50 disabled:pointer-events-none shadow-sm";
		const variants: Record<Variant, string> = {
            default: "bg-[var(--primary)] text-white hover:bg-[var(--primary-600)]",
            outline: "border border-[var(--color-border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-gray-50",
            ghost: "bg-transparent hover:bg-gray-100 text-[var(--foreground)]",
		};
		const sizes: Record<Size, string> = {
            sm: "h-8 px-3 text-sm",
            md: "h-10 px-4 text-sm",
            lg: "h-11 px-5 text-base",
		};
		return (
			<button ref={ref} className={clsx(base, variants[variant], sizes[size], className)} {...props} />
		);
	}
);

Button.displayName = "Button";


