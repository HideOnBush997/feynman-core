using System.Security.Cryptography;
using System.Text;
using Feynman.Api.Auth;
using Xunit;

namespace Feynman.Auth.Tests;

public class AuthCryptoTests
{
    internal static AuthOptions Options() => new()
    {
        SigningKey = new string('s', 64),
        HmacKey = new string('h', 64),
        ReceiptEncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        AllowedOrigins = ["https://localhost:5173"]
    };
    [Fact]
    public void CsrfIsSignedAndBoundToFamily()
    {
        var crypto = new AuthCrypto(Options());
        var family = Guid.NewGuid();
        var value = crypto.Csrf(family);
        Assert.True(crypto.ValidCsrf(value, family));
        Assert.False(crypto.ValidCsrf(value, Guid.NewGuid()));
        var signatureStart = value.LastIndexOf('.') + 1;
        var tampered = value[..signatureStart] + (value[signatureStart] == 'A' ? "B" : "A") + value[(signatureStart + 1)..];
        Assert.False(crypto.ValidCsrf(tampered, family));
        Assert.False(crypto.ValidCsrf("invalid", family));
        Assert.False(crypto.ValidCsrf(null, family));
    }
    [Fact]
    public void RotationReceiptRoundTripsAndRejectsTampering()
    {
        var crypto = new AuthCrypto(Options());
        var input = Encoding.UTF8.GetBytes("temporary refresh material");
        var encrypted = crypto.Encrypt(input);
        Assert.Equal(input, crypto.Decrypt(encrypted));
        Assert.NotEqual(encrypted, crypto.Encrypt(input));
        encrypted[^1] ^= 1;
        Assert.ThrowsAny<CryptographicException>(() => crypto.Decrypt(encrypted));
    }
    [Fact]
    public void TokenFingerprintsAreKeyedAndRandomTokensAreDistinct()
    {
        var options = Options();
        var crypto = new AuthCrypto(options);
        var token = AuthCrypto.RandomToken();
        Assert.NotEqual(token, AuthCrypto.RandomToken());
        Assert.Equal(32, crypto.Fingerprint(token).Length);
        Assert.Equal(crypto.Fingerprint(token), crypto.Fingerprint(token));
        options.HmacKey = new string('x', 64);
        Assert.NotEqual(new AuthCrypto(Options()).Fingerprint(token), crypto.Fingerprint(token));
    }
    [Theory]
    [InlineData("*")]
    [InlineData("https://localhost:5173/")]
    [InlineData("https://localhost:5173/path")]
    public void OriginsMustBeExplicitExactOrigins(string origin)
    {
        var options = Options();
        options.AllowedOrigins = [origin];
        Assert.Throws<InvalidOperationException>(options.Validate);
    }
}
