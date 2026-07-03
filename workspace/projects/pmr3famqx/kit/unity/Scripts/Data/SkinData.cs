using UnityEngine;

[CreateAssetMenu(fileName = "SkinData", menuName = "Game/Data/SkinData", order = 0)]
public class SkinData : ScriptableObject
{
    public string skinName; // "Cheese", "Fish", "Kimchi"
    public float bounceMultiplier = 1.5f;
    public float frictionCoefficient = 0.8f;
    public float explosionRadius = 1.5f;
    public int maxCollisions = 3;
    public float cooldownSeconds = 0.1f;
    public Color trailColor = Color.white;
}
