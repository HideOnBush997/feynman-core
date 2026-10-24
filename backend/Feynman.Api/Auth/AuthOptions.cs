using System.Security.Cryptography;
using System.Text;

namespace Feynman.Api.Auth;

public sealed class AuthOptions
{
    public string Issuer { get; set; } = "Feynman.Api";
    public string Audience { get; set; } = "Feynman.Spa";
    public string SigningKey { get; set; } = "";
    public string HmacKey { get; set; } = "";
    public string ReceiptEncryptionKey { get; set; } = "";
    public string[] AllowedOrigins { get; set; } = [];
    public string CookieSameSite { get; set; } = "Lax";
    public int IdempotencySeconds { get; set; } = 10;

    public void Validate()
    {
        if (Encoding.UTF8.GetByteCount(SigningKey) < 32 || Encoding.UTF8.GetByteCount(HmacKey) < 32)
            throw new InvalidOperationException("Auth signing and HMAC keys must be at least 32 UTF-8 bytes.");
        try { if (Convert.FromBase64String(ReceiptEncryptionKey).Length != 32) throw new FormatException(); }
        catch (FormatException) { throw new InvalidOperationException("Auth:ReceiptEncryptionKey must be a base64-encoded 32-byte key."); }
        if (AllowedOrigins.Length == 0 || AllowedOrigins.Any(o => !Uri.TryCreate(o, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http") || u.GetLeftPart(UriPartial.Authority) != o))
            throw new InvalidOperationException("Auth:AllowedOrigins requires exact HTTP/HTTPS origins without paths or trailing slash.");
        if (CookieSameSite is not ("Lax" or "None") || IdempotencySeconds is < 1 or > 60)
            throw new InvalidOperationException("Auth CookieSameSite must be Lax/None and IdempotencySeconds must be 1–60.");
    }
}

public sealed class AuthCrypto(AuthOptions options)
{
    public static string RandomToken() => Microsoft.IdentityModel.Tokens.Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));
    public byte[] Fingerprint(string token) => HMACSHA256.HashData(Encoding.UTF8.GetBytes(options.HmacKey), Encoding.UTF8.GetBytes(token));
    public string Csrf(Guid familyId)
    {
        var value = $"{familyId:N}.{RandomToken()}";
        return value + "." + Microsoft.IdentityModel.Tokens.Base64UrlEncoder.Encode(Fingerprint("csrf:" + value));
    }
    public bool ValidCsrf(string? value, Guid familyId)
    {
        if (value is null || value.Length > 256) return false;
        var parts = value.Split('.');
        if (parts.Length != 3 || parts[0] != familyId.ToString("N")) return false;
        try
        {
            return CryptographicOperations.FixedTimeEquals(Microsoft.IdentityModel.Tokens.Base64UrlEncoder.DecodeBytes(parts[2]), Fingerprint("csrf:" + parts[0] + "." + parts[1]));
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException) { return false; }
    }
    public byte[] Encrypt(byte[] plain)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(Convert.FromBase64String(options.ReceiptEncryptionKey), 16);
        aes.Encrypt(nonce, plain, cipher, tag);
        return [.. nonce, .. tag, .. cipher];
    }
    public byte[] Decrypt(byte[] encrypted)
    {
        if (encrypted.Length < 28) throw new CryptographicException("Invalid receipt.");
        var plain = new byte[encrypted.Length - 28];
        using var aes = new AesGcm(Convert.FromBase64String(options.ReceiptEncryptionKey), 16);
        aes.Decrypt(encrypted.AsSpan(0, 12), encrypted.AsSpan(28), encrypted.AsSpan(12, 16), plain);
        return plain;
    }
}
