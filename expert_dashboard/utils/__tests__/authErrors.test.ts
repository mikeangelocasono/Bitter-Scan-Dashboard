/**
 * Tests for authentication error handling utilities
 */

import { 
  mapSupabaseAuthError, 
  mapSupabaseDbError, 
  validateEmail, 
  validateUsername, 
  validatePasswordStrength 
} from '../authErrors';

describe('Authentication Error Handling', () => {
  describe('mapSupabaseAuthError', () => {
    it('should map invalid credentials error', () => {
      const result = mapSupabaseAuthError('Invalid login credentials');
      expect(result).toBe('Incorrect email or password. Please try again.');
    });

    it('should map email not confirmed error', () => {
      const result = mapSupabaseAuthError('Email not confirmed');
      expect(result).toBe('Please check your email and confirm your account before signing in.');
    });

    it('should map rate limiting error', () => {
      const result = mapSupabaseAuthError('Too many requests');
      expect(result).toBe('Too many attempts. Please try again later.');
    });

    it('should map already registered error', () => {
      const result = mapSupabaseAuthError('User already registered');
      expect(result).toBe('An account with this email already exists. Please try signing in instead.');
    });

    it('should return unknown error for unrecognized messages', () => {
      const result = mapSupabaseAuthError('Some random error');
      expect(result).toBe('Something went wrong. Please try again.');
    });

    it('should handle undefined input', () => {
      const result = mapSupabaseAuthError();
      expect(result).toBe('Something went wrong. Please try again.');
    });
  });

  describe('mapSupabaseDbError', () => {
    it('should map username duplicate key error', () => {
      const result = mapSupabaseDbError('duplicate key value violates unique constraint "profiles_username_key"');
      expect(result).toBe('This username is already taken. Please choose a different one.');
    });

    it('should map email duplicate key error', () => {
      const result = mapSupabaseDbError('duplicate key value violates unique constraint "profiles_email_key"');
      expect(result).toBe('An account with this email already exists. Please try signing in instead.');
    });

    it('should map permission error', () => {
      const result = mapSupabaseDbError('permission denied');
      expect(result).toBe('You do not have permission to perform this action.');
    });

    it('should return unknown error for unrecognized messages', () => {
      const result = mapSupabaseDbError('Some random database error');
      expect(result).toBe('Something went wrong. Please try again.');
    });
  });

  describe('validateEmail', () => {
    it('should validate correct email formats', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user.name@domain.co.uk')).toBe(true);
      expect(validateEmail('user+tag@example.org')).toBe(true);
    });

    it('should reject invalid email formats', () => {
      expect(validateEmail('invalid-email')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('test@')).toBe(false);
      expect(validateEmail('')).toBe(false);
    });
  });

  describe('validateUsername', () => {
    it('should validate correct usernames', () => {
      expect(validateUsername('validuser')).toEqual({ isValid: true });
      expect(validateUsername('user_123')).toEqual({ isValid: true });
      expect(validateUsername('user-name')).toEqual({ isValid: true });
    });

    it('should reject usernames that are too short', () => {
      const result = validateUsername('ab');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Username must be at least 3 characters long');
    });

    it('should reject usernames that are too long', () => {
      const result = validateUsername('a'.repeat(21));
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Username must be no more than 20 characters long');
    });

    it('should reject usernames with invalid characters', () => {
      const result = validateUsername('user@name');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Username can only contain letters, numbers, underscores, and hyphens');
    });
  });

  describe('validatePasswordStrength', () => {
    it('should validate strong passwords', () => {
      const result = validatePasswordStrength('StrongPass123!');
      expect(result.isValid).toBe(true);
      expect(result.strength).toBe('strong');
      expect(result.errors).toHaveLength(0);
    });

    it('should validate medium passwords', () => {
      const result = validatePasswordStrength('MediumPass123');
      expect(result.isValid).toBe(true);
      expect(result.strength).toBe('medium');
      expect(result.errors).toHaveLength(0);
    });

    it('should reject passwords that are too short', () => {
      const result = validatePasswordStrength('Short1');
      expect(result.isValid).toBe(false);
      expect(result.strength).toBe('weak');
      expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    it('should reject passwords without letters', () => {
      const result = validatePasswordStrength('12345678');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one letter');
    });

    it('should reject passwords without numbers or symbols', () => {
      const result = validatePasswordStrength('PasswordOnly');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number or symbol');
    });

    it('should handle multiple validation errors', () => {
      const result = validatePasswordStrength('abc');
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain('Password must be at least 8 characters long');
      expect(result.errors).toContain('Password must contain at least one number or symbol');
    });
  });
});
